import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { callTelegram } from '../bot/telegram-api';
import { PrismaService } from '../prisma/prisma.service';
import { describeImport, importPriceList } from './import-price-list';
import { CENTRAL_WAREHOUSE, CHERY_WAREHOUSE } from '../catalog/offers';
import { mailKey, mailRoutes, routeMail } from './mail-routing';

const DEFAULT_INTERVAL_MIN = 10;
// Only recent mail is looked at: the price list arrives several times a day and only the newest
// one matters, so there's no point paging through the mailbox's history.
const LOOKBACK_DAYS = 3;
const FIRST_RUN_DELAY_MS = 60_000;
const EXCEL_FILE = /\.xlsx?$/i;

const IMAP_HOSTS: Array<[RegExp, string]> = [
  [/@(yandex\.(ru|com|by|kz)|ya\.ru)$/i, 'imap.yandex.ru'],
  [/@(mail\.ru|bk\.ru|list\.ru|inbox\.ru|internet\.ru)$/i, 'imap.mail.ru'],
  [/@(gmail|googlemail)\.com$/i, 'imap.gmail.com'],
];

/** What the watchdog reads from GET /api/health/details. */
export interface PriceSyncStatus {
  enabled: boolean;
  startedAt: string;
  lastCheckOkAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Every email from the supplier in the lookback window, by subject - so a stale price list
   *  can be explained ("only «МСК наличие» arrived, nothing matched the filter"). */
  supplierMail: Array<{ subject: string; count: number; lastAt: string; matched: boolean }>;
}

interface Candidate {
  folder: string;
  warehouseCode: string;
  uid: number;
  messageId: string;
  date: Date;
}

/**
 * Picks up the supplier's emailed price list and applies it to the catalog.
 *
 * The mailbox is the owner's own, so it is opened with EXAMINE (readOnly): nothing gets marked
 * read, moved or deleted - the server itself refuses flag changes on a read-only session. Which
 * emails were already handled is tracked in PriceImport by Message-ID instead.
 */
@Injectable()
export class PriceSyncService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PriceSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly startedAt = new Date();
  private lastCheckOkAt: Date | null = null;
  private lastFailureAt: Date | null = null;
  private lastError: string | null = null;
  private consecutiveFailures = 0;
  private supplierMail: PriceSyncStatus['supplierMail'] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.PRICE_SYNC_ENABLED !== 'true') {
      this.logger.log('Price sync disabled (set PRICE_SYNC_ENABLED=true to enable)');
      return;
    }
    if (!process.env.PRICE_IMAP_USER || !process.env.PRICE_IMAP_PASSWORD || !process.env.PRICE_MAIL_FROM) {
      this.logger.error('Price sync needs PRICE_IMAP_USER, PRICE_IMAP_PASSWORD and PRICE_MAIL_FROM - not starting');
      return;
    }
    const intervalMin = Number(process.env.PRICE_SYNC_INTERVAL_MIN) || DEFAULT_INTERVAL_MIN;
    this.logger.log(`Price sync enabled: checking ${process.env.PRICE_IMAP_USER} every ${intervalMin} min`);
    this.timer = setTimeout(() => this.tick(intervalMin), FIRST_RUN_DELAY_MS);
  }

  onApplicationShutdown() {
    clearTimeout(this.timer);
  }

  getStatus(): PriceSyncStatus {
    return {
      enabled: process.env.PRICE_SYNC_ENABLED === 'true',
      startedAt: this.startedAt.toISOString(),
      lastCheckOkAt: this.lastCheckOkAt?.toISOString() ?? null,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
      supplierMail: this.supplierMail,
    };
  }

  private tick(intervalMin: number) {
    void this.runOnce().finally(() => {
      this.timer = setTimeout(() => this.tick(intervalMin), intervalMin * 60_000);
    });
  }

  /** One pass over the mailbox. Never overlaps with itself; never throws. */
  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    let client: ImapFlow | undefined;
    try {
      client = this.createClient();
      await client.connect();
      await this.processNewMail(client, await this.resolveFolders(client));
      this.lastCheckOkAt = new Date();
      this.consecutiveFailures = 0;
    } catch (err) {
      // Gmail drops an IMAP connection now and then; one failed pass is retried in 10 minutes
      // and isn't worth a message. The watchdog (deploy/watchdog) alerts if checks keep failing
      // for an hour. imapflow often leaves `message` empty, so take whatever says the most.
      const e = err as Error & { responseText?: string; code?: string };
      const message = e.responseText || e.message || e.code || String(err);
      this.lastFailureAt = new Date();
      this.lastError = message;
      this.consecutiveFailures++;
      this.logger.error(`Price sync failed (${this.consecutiveFailures} in a row): ${message}`);
    } finally {
      this.running = false;
      await client?.logout().catch(() => client?.close());
    }
  }

  /**
   * Where price emails may be. The owner may archive them with a filter or block the sender so
   * they land in spam, so besides the inbox: Gmail's "All Mail" (\All - inbox, archive and every
   * label in one place) and the spam folder (\Junk). PRICE_MAIL_FOLDERS overrides the list.
   */
  private async resolveFolders(client: ImapFlow): Promise<string[]> {
    const configured = process.env.PRICE_MAIL_FOLDERS?.split(',').map((f) => f.trim()).filter(Boolean);
    if (configured?.length) {
      return configured;
    }
    const mailboxes = await client.list();
    const all = mailboxes.find((m) => m.specialUse === '\\All')?.path;
    const junk = mailboxes.find((m) => m.specialUse === '\\Junk')?.path;
    return [all ?? 'INBOX', ...(junk ? [junk] : [])];
  }

  private async processNewMail(client: ImapFlow, folders: string[]): Promise<void> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    // Everything from the sender, filtered by subject here rather than in the IMAP query: the
    // emails that don't match are what explains a stale price list.
    const routes = mailRoutes();
    const from = [...new Set(routes.filter((r) => r.enabled && r.from).map((r) => r.from))];
    if (!from.length) return;
    const query = from.length === 1 ? { from: from[0], since } : { or: from.map((sender) => ({ from: sender })), since };

    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const bySubject = new Map<string, PriceSyncStatus['supplierMail'][number]>();
    for (const folder of folders) {
      await client.mailboxOpen(folder, { readOnly: true });
      const uids = (await client.search(query, { uid: true })) || [];
      if (uids.length === 0) {
        continue;
      }
      for await (const msg of client.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
        const internalDate = msg.internalDate ? new Date(msg.internalDate) : undefined;
        // Message-ID is the stable identity across sessions and folders; UIDs are per folder and
        // can be renumbered by the server.
        const messageId = msg.envelope?.messageId ?? `<uid-${folder}-${msg.uid}@${process.env.PRICE_IMAP_USER}>`;
        if (seen.has(messageId)) {
          continue;
        }
        seen.add(messageId);
        const date = internalDate ?? (msg.envelope?.date ? new Date(msg.envelope.date) : new Date(0));
        const subject = msg.envelope?.subject ?? '';
        const route = routeMail(msg.envelope?.from?.map((sender) => sender.address ?? '') ?? [], subject, routes);
        const matched = Boolean(route?.enabled);

        // "Прайс … от 03.11.2026" -> one entry per mailing, not per day.
        const key = subject.replace(/\s*от\s+\d{2}\.\d{2}\.\d{4}\s*$/, '').trim() || '(без темы)';
        const entry = bySubject.get(key) ?? { subject: key, count: 0, lastAt: date.toISOString(), matched };
        entry.count++;
        if (date.toISOString() > entry.lastAt) entry.lastAt = date.toISOString();
        bySubject.set(key, entry);

        if (route?.enabled) {
          candidates.push({ folder, uid: msg.uid, messageId, date, warehouseCode: route.warehouseCode });
        }
      }
    }
    this.supplierMail = [...bySubject.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    if (candidates.length === 0) {
      return;
    }

    const known = await this.prisma.priceImport.findMany({
      where: { messageId: { in: candidates.map((c) => c.messageId) } },
      select: { messageId: true },
    });
    const knownIds = new Set(known.map((k) => k.messageId));
    for (const route of routes.filter((r) => r.enabled)) {
      const lastApplied = await this.prisma.priceImport.findFirst({
        where: { warehouseCode: route.warehouseCode, status: 'APPLIED', source: 'email' },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true },
      });
      const fresh = candidates
        .filter((c) => c.warehouseCode === route.warehouseCode && !knownIds.has(c.messageId))
        .sort((a, b) => b.date.getTime() - a.date.getTime());

      let applied = false;
      for (const candidate of fresh) {
        if (applied || (lastApplied?.receivedAt && candidate.date <= lastApplied.receivedAt)) {
          await this.record(candidate);
          continue;
        }

        const attachment = await this.findPriceAttachment(client, candidate, routes);
        if (!attachment) {
          await this.record(candidate, 'Нет однозначно выбранного вложения .xls/.xlsx');
          continue;
        }

        const result = await importPriceList(this.prisma, attachment.content, {
          source: 'email',
          messageUid: candidate.uid,
          messageId: candidate.messageId,
          receivedAt: candidate.date,
          fileName: attachment.filename,
        }, { warehouseCode: candidate.warehouseCode });
        this.logger.log(`Price list ${candidate.warehouseCode}/${attachment.filename}: ${result.status}, ${result.rows} rows`);
        applied = result.status === 'APPLIED';
        await this.report(describeImport(result), applied).catch(() => this.logger.warn('Price list report was not sent'));
      }
    }
  }

  private async findPriceAttachment(client: ImapFlow, candidate: Candidate, routes: ReturnType<typeof mailRoutes>) {
    // With the mailbox opened read-only, fetching the body can't set \Seen.
    await client.mailboxOpen(candidate.folder, { readOnly: true });
    const message = await client.fetchOne(String(candidate.uid), { source: true }, { uid: true });
    if (!message || !message.source) {
      return undefined;
    }
    const parsed = await simpleParser(message.source);
    const route = routes.find((r) => r.warehouseCode === candidate.warehouseCode)!;
    const opt2 = routes.find((r) => r.warehouseCode === CHERY_WAREHOUSE)!;
    const attachments = parsed.attachments.filter((a) => {
      if (!a.filename || !EXCEL_FILE.test(a.filename)) return false;
      const name = mailKey(a.filename);
      if (route.warehouseCode === CENTRAL_WAREHOUSE && (name.includes(opt2.subject) || (opt2.attachment && name.includes(opt2.attachment)))) return false;
      return name.includes(route.attachment);
    });
    if (attachments.length !== 1) return undefined;
    return { filename: attachments[0].filename!, content: attachments[0].content };
  }

  private record(candidate: Candidate, error?: string) {
    const data = {
      source: 'email',
      warehouseCode: candidate.warehouseCode,
      messageUid: candidate.uid,
      messageId: candidate.messageId,
      receivedAt: candidate.date,
      status: 'SKIPPED' as const,
      error,
    };
    return this.prisma.priceImport.upsert({ where: { messageId: candidate.messageId }, create: data, update: {} });
  }

  private createClient(): ImapFlow {
    const user = process.env.PRICE_IMAP_USER as string;
    const host = process.env.PRICE_IMAP_HOST || IMAP_HOSTS.find(([pattern]) => pattern.test(user))?.[1];
    if (!host) {
      throw new Error(`Не знаю IMAP-сервер для ${user} — задайте PRICE_IMAP_HOST`);
    }
    return new ImapFlow({
      host,
      port: Number(process.env.PRICE_IMAP_PORT) || 993,
      secure: true,
      auth: { user, pass: process.env.PRICE_IMAP_PASSWORD as string },
      logger: false,
    });
  }

  private async report(text: string, silent = false): Promise<void> {
    const chatId = process.env.PRICE_REPORT_CHAT_ID || process.env.BACKUP_CHAT_ID;
    if (!chatId) {
      return;
    }
    await callTelegram('sendMessage', { chat_id: chatId, text, disable_notification: silent });
  }
}
