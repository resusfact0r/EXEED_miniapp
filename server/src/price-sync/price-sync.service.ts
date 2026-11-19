import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationShutdown, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { callTelegram } from '../bot/telegram-api';
import { PrismaService } from '../prisma/prisma.service';
import { describeImport, importPriceList } from './import-price-list';
import { articleKey, CENTRAL_WAREHOUSE, CHERY_WAREHOUSE } from '../catalog/offers';
import { knownMailSubjects, mailKey, mailRoutes, routeMail, type MailRoute } from './mail-routing';
import { inspectPriceList, parsePriceList, type PriceFormat } from './excel-parser';

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
  subject: string;
}

interface MailRequest extends PriceFormat {
  warehouseCode: string;
  subjects: string[];
  attachment?: string;
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

  private async scanMail(client: ImapFlow, folders: string[], routes: MailRoute[]) {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    // Everything from the sender, filtered by subject here rather than in the IMAP query: the
    // emails that don't match are what explains a stale price list.
    const from = [...new Set(routes.filter((r) => r.enabled && r.from).map((r) => r.from))];
    if (!from.length) return { candidates: [], supplierMail: [] };
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
        entry.matched ||= matched;
        if (date.toISOString() > entry.lastAt) entry.lastAt = date.toISOString();
        bySubject.set(key, entry);

        if (route?.enabled) {
          candidates.push({ folder, uid: msg.uid, messageId, date, subject, warehouseCode: route.warehouseCode });
        }
      }
    }
    return { candidates, supplierMail: [...bySubject.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)) };
  }

  private async processNewMail(client: ImapFlow, folders: string[]) {
    const routes = await this.configuredRoutes();
    const { candidates, supplierMail } = await this.scanMail(client, folders, routes);
    this.supplierMail = supplierMail;
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
        }, { warehouseCode: candidate.warehouseCode, format: route.format });
        this.logger.log(`Price list ${candidate.warehouseCode}/${attachment.filename}: ${result.status}, ${result.rows} rows`);
        applied = result.status === 'APPLIED';
        if (!route.format) {
          await this.report(describeImport(result), applied).catch(() => this.logger.warn('Price list report was not sent'));
        }
      }
    }
  }

  private async spreadsheetAttachments(client: ImapFlow, candidate: Candidate) {
    // With the mailbox opened read-only, fetching the body can't set \Seen.
    await client.mailboxOpen(candidate.folder, { readOnly: true });
    const message = await client.fetchOne(String(candidate.uid), { source: true }, { uid: true });
    if (!message || !message.source) return [];
    const parsed = await simpleParser(message.source);
    return parsed.attachments.filter((a) => a.filename && EXCEL_FILE.test(a.filename))
      .map((a) => ({ filename: a.filename!, content: a.content }));
  }

  private matchingAttachments(files: { filename: string; content: Buffer }[], route: MailRoute, routes: MailRoute[]) {
    const otherMarkers = route.warehouseCode === CENTRAL_WAREHOUSE
      ? [
          ...Object.entries(knownMailSubjects).filter(([code]) => code !== CENTRAL_WAREHOUSE).flatMap(([, markers]) => markers),
          ...routes.filter((r) => r.warehouseCode !== CENTRAL_WAREHOUSE).flatMap((r) => [...r.subjects, r.attachment]),
          'central price geely',
        ].filter(Boolean)
      : [];
    return files.filter(({ filename }) => {
      const name = mailKey(filename);
      return name.includes(route.attachment) && !otherMarkers.some((marker) => name.includes(marker));
    });
  }

  private async findPriceAttachment(client: ImapFlow, candidate: Candidate, routes: MailRoute[]) {
    const route = routes.find((r) => r.warehouseCode === candidate.warehouseCode)!;
    const files = this.matchingAttachments(await this.spreadsheetAttachments(client, candidate), route, routes);
    return files.length === 1 ? files[0] : undefined;
  }

  private async configuredRoutes() {
    const legacy = mailRoutes();
    const stored = await this.prisma.warehouse.findMany({
      where: { mailSubjects: { isEmpty: false } },
      select: { code: true, mailSubjects: true, mailAttachment: true, mailSheet: true, mailColumns: true },
    });

    const active: MailRoute[] = stored.map((row) => ({
      warehouseCode: row.code,
      from: this.feedSender(row.code, legacy),
      subjects: row.mailSubjects.map(mailKey).filter(Boolean),
      attachment: mailKey(row.mailAttachment ?? ''),
      enabled: true,
      format: {
        sheet: row.mailSheet ?? undefined,
        columns: row.mailColumns as PriceFormat['columns'] ?? undefined,
      },
    }));
    return [...active, ...legacy.filter((r) => !active.some((a) => a.warehouseCode === r.warehouseCode))];
  }

  private feedSender(code: string, routes: MailRoute[]) {
    return routes.find((route) => route.warehouseCode === code)?.from || mailKey(process.env.PRICE_MAIL_FROM ?? '');
  }

  async mailOverview() {
    const status = this.getStatus();
    const routes = await this.configuredRoutes();
    return {
      enabled: status.enabled,
      lastCheckOkAt: status.lastCheckOkAt,
      lastFailureAt: status.lastFailureAt,
      consecutiveFailures: status.consecutiveFailures,
      supplierMail: status.supplierMail,
      feeds: routes.map(({ warehouseCode, subjects, attachment, enabled, format }) =>
        ({ warehouseCode, subjects, attachment, enabled, ...format })),
    };
  }

  private async findPreview(dto: MailRequest) {
    const subjects = [...new Set(dto.subjects.map(mailKey))];
    if (subjects.some((subject) => subject.length < 5)) throw new BadRequestException('Укажите постоянную часть темы письма.');
    const warehouse = await this.prisma.warehouse.findUnique({ where: { code: dto.warehouseCode } });
    if (!warehouse) throw new BadRequestException('Выберите существующий склад.');
    const routes = mailRoutes();
    const from = this.feedSender(dto.warehouseCode, routes);
    if (!from || !process.env.PRICE_IMAP_USER || !process.env.PRICE_IMAP_PASSWORD) {
      throw new ServiceUnavailableException('Почтовый ящик или адрес поставщика не настроен.');
    }
    const columns = Object.fromEntries(Object.entries(dto.columns ?? {}).filter(([, v]) => v?.trim()).map(([k,v]) => [k, v.trim()]));
    const format: PriceFormat = { sheet: dto.sheet?.trim() || undefined, columns };
    const route = {
      warehouseCode: dto.warehouseCode, from, subjects, attachment: mailKey(dto.attachment ?? ''), enabled: true, format,
    };
    const client = this.createClient();
    try {
      await client.connect();
      const { candidates } = await this.scanMail(client, await this.resolveFolders(client), [route]);
      const candidate = candidates.sort((a,b) => b.date.getTime() - a.date.getTime())[0];
      if (!candidate) throw new BadRequestException('У настроенного отправителя не найдено свежего письма с этой темой.');
      const attachments = await this.spreadsheetAttachments(client, candidate);
      const files = this.matchingAttachments(attachments, route, routes);
      if (files.length !== 1) {
        throw new BadRequestException(files.length > 1
          ? 'Уточните имя вложения. Найдены: ' + files.map((f) => f.filename).join(', ')
          : 'В последнем письме нет подходящего вложения .xls или .xlsx.');
      }
      const file = files[0];
      const sheets = inspectPriceList(file.content);
      const previewId = createHash('sha256').update(JSON.stringify([route, candidate.messageId, candidate.date]))
        .update(file.content).digest('hex');
      let parsed;
      let parseError;
      const central = dto.warehouseCode === CENTRAL_WAREHOUSE;
      try {
        const data = parsePriceList(file.content, {
          envPrefix: central ? 'PRICE_' : dto.warehouseCode === CHERY_WAREHOUSE ? 'PRICE_MSK_OPT2_' : undefined,
          brandFilter: central ? undefined : warehouse.brandFilter ?? undefined,
          format,
        });
        const articles = [...new Set(data.rows.map((row) => articleKey(row.code)))];
        const [{ centralMatches }] = await this.prisma.$queryRaw<{ centralMatches: number }[]>`
          SELECT count(*)::int AS "centralMatches" FROM "Product"
          WHERE "isActive" AND upper(btrim(code)) = ANY(${articles}::text[])
        `;
        parsed = {
          sheet: data.sheet, columns: data.columns, articles: articles.length, invalidPrices: data.badPriceRows,
          available: data.rows.filter((row) => row.stock && row.stock >= (row.pack ?? warehouse.defaultPackQty)).length,
          centralMatches,
          singleUnits: data.rows.filter((row) => row.stock && (row.pack ?? warehouse.defaultPackQty) === 1).length,
        };
        if (!data.columns.stock) parseError = 'Укажите колонку с остатком для выбранного склада.';
        if (!articles.length) parseError = 'В выбранном листе нет позиций для этого склада.';
      } catch (error) {
        parseError = (error as Error).message;
      }
      return {
        candidate, file, route, format, previewId,
        details: { subject: candidate.subject, receivedAt: candidate.date, fileName: file.filename, sheets, parsed, parseError, previewId },
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn('Could not read the latest supplier attachment');
      throw new ServiceUnavailableException('Не удалось прочитать письмо или таблицу поставщика.');
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  async previewMail(dto: MailRequest) {
    return (await this.findPreview(dto)).details;
  }

  async connectMail(dto: MailRequest & { previewId: string }) {
    if (process.env.PRICE_SYNC_ENABLED !== 'true') throw new ServiceUnavailableException('Автоимпорт почты выключен.');
    const { candidate, file, route, previewId, details } = await this.findPreview(dto);
    if (dto.previewId !== previewId) throw new ConflictException('Письмо или настройки изменились. Сначала обновите предпросмотр.');
    if (details.parseError || !details.parsed) throw new BadRequestException(details.parseError ?? 'Проверьте таблицу.');
    const format: PriceFormat = { sheet: details.parsed.sheet, columns: details.parsed.columns };
    const result = await importPriceList(this.prisma, file.content, {
      source: 'email', fileName: file.filename, messageId: candidate.messageId,
      messageUid: candidate.uid, receivedAt: candidate.date,
    }, {
      warehouseCode: dto.warehouseCode,
      format,
      mailRule: {
        mailSubjects: route.subjects,
        mailAttachment: route.attachment || null,
        mailSheet: format.sheet ?? null,
        mailColumns: format.columns as Prisma.InputJsonValue ?? Prisma.DbNull,
      },
    });
    if (result.warehouseCode !== dto.warehouseCode || result.status !== 'APPLIED') {
      throw new ConflictException(result.error ?? 'Файл уже обработан в другом складе или появился более свежий прайс.');
    }
    return { warehouseCode: result.warehouseCode, fileName: result.fileName, rows: result.rows, status: result.status };
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
