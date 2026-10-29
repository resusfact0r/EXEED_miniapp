import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { callTelegram } from '../bot/telegram-api';
import { PrismaService } from '../prisma/prisma.service';
import { describeImport, importPriceList } from './import-price-list';

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

interface Candidate {
  folder: string;
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
  // A broken mailbox login would otherwise repeat the same alert every 10 minutes.
  private mailboxFailing = false;

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
      if (this.mailboxFailing) {
        this.mailboxFailing = false;
        await this.report('✅ Доступ к почте с прайсом восстановлен.');
      }
    } catch (err) {
      const message = (err as Error & { responseText?: string }).responseText ?? (err as Error).message;
      this.logger.error(`Price sync failed: ${message}`);
      if (!this.mailboxFailing) {
        this.mailboxFailing = true;
        await this.report(`❌ Не удалось проверить почту с прайсом: ${message}\nЦены в каталоге не обновляются, пока это не исправлено.`);
      }
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
    const query: Record<string, unknown> = { from: process.env.PRICE_MAIL_FROM, since };
    if (process.env.PRICE_MAIL_SUBJECT) {
      query.subject = process.env.PRICE_MAIL_SUBJECT;
    }

    const candidates: Candidate[] = [];
    const seen = new Set<string>();
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
        candidates.push({
          folder,
          uid: msg.uid,
          messageId,
          date: internalDate ?? (msg.envelope?.date ? new Date(msg.envelope.date) : new Date(0)),
        });
      }
    }
    if (candidates.length === 0) {
      return;
    }

    const known = await this.prisma.priceImport.findMany({
      where: { messageId: { in: candidates.map((c) => c.messageId) } },
      select: { messageId: true },
    });
    const knownIds = new Set(known.map((k) => k.messageId));
    const lastApplied = await this.prisma.priceImport.findFirst({
      where: { status: 'APPLIED', source: 'email' },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });

    const fresh = candidates
      .filter((c) => !knownIds.has(c.messageId))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    let applied = false;
    for (const candidate of fresh) {
      // Anything older than the newest list already applied - or than the one just applied in
      // this pass - is out of date: record it so it isn't looked at again, but don't apply it.
      if (applied || (lastApplied?.receivedAt && candidate.date <= lastApplied.receivedAt)) {
        await this.record(candidate, 'SKIPPED');
        continue;
      }

      const attachment = await this.findPriceAttachment(client, candidate);
      if (!attachment) {
        await this.record(candidate, 'SKIPPED', undefined, 'В письме нет вложения .xls/.xlsx');
        continue;
      }

      const result = await importPriceList(this.prisma, attachment.content, {
        source: 'email',
        messageUid: candidate.uid,
        messageId: candidate.messageId,
        receivedAt: candidate.date,
        fileName: attachment.filename,
      });
      this.logger.log(`Price list ${attachment.filename}: ${result.status}, ${result.rows} rows`);
      // A routine successful update arrives silently; problems ring.
      await this.report(describeImport(result), result.status === 'APPLIED');
      applied = result.status === 'APPLIED';
    }
  }

  private async findPriceAttachment(client: ImapFlow, candidate: Candidate) {
    // With the mailbox opened read-only, fetching the body can't set \Seen.
    await client.mailboxOpen(candidate.folder, { readOnly: true });
    const message = await client.fetchOne(String(candidate.uid), { source: true }, { uid: true });
    if (!message || !message.source) {
      return undefined;
    }
    const parsed = await simpleParser(message.source);
    const attachment = parsed.attachments.find((a) => a.filename && EXCEL_FILE.test(a.filename));
    return attachment ? { filename: attachment.filename as string, content: attachment.content } : undefined;
  }

  private record(candidate: Candidate, status: 'SKIPPED', fileName?: string, error?: string) {
    return this.prisma.priceImport.create({
      data: {
        source: 'email',
        messageUid: candidate.uid,
        messageId: candidate.messageId,
        receivedAt: candidate.date,
        fileName,
        status,
        error,
      },
    });
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
