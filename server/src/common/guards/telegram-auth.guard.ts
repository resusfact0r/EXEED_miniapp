import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { isExpiredError, isValid, parse, validate } from '@telegram-apps/init-data-node';

import { PrismaService } from '../../prisma/prisma.service';

const INIT_DATA_MAX_AGE_SECONDS = 86400;

/**
 * @telegram-apps/init-data-node's declared return type for parse() does not match its actual
 * runtime output (verified empirically: keys stay snake_case, e.g. `user.first_name`, not
 * `user.firstName`, despite the misleading "CamelCaseSchemaParser" type name). We type against
 * the verified runtime shape instead of trusting the package's generic type inference.
 */
interface ParsedInitData {
  auth_date: Date;
  hash: string;
  user?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
}

@Injectable()
export class TelegramAuthGuard implements CanActivate {
  /**
   * Why a launch was refused, for the log: expired or a foreign signature, how old it is, and
   * whether it was signed by the previous bot (TELEGRAM_BOT_TOKEN_PREVIOUS - checked here only,
   * never accepted). After the bot was replaced, Telegram kept reopening the old bot's Mini App
   * from its recent apps, and "Invalid Telegram init data" alone didn't say so.
   */
  private describeRejection(initDataRaw: string, err: unknown): string {
    const params = new URLSearchParams(initDataRaw);
    const authDate = Number(params.get('auth_date'));
    const age = Number.isFinite(authDate) && authDate > 0 ? `${Math.round(Date.now() / 1000 - authDate)} s old` : 'no auth_date';
    let userId = 'unknown user';
    try {
      userId = `user ${JSON.parse(params.get('user') ?? '{}').id ?? '?'}`;
    } catch {
      // keep "unknown user"
    }
    const previous = process.env.TELEGRAM_BOT_TOKEN_PREVIOUS;
    const byPrevious = previous ? (isValid(initDataRaw, previous, { expiresIn: 0 }) ? 'yes' : 'no') : 'not configured';
    const reason = isExpiredError(err) ? 'expired' : (err as Error).message || (err as Error).name;
    return `${reason}; ${userId}; ${age}; signed by previous bot: ${byPrevious}; fields: ${[...params.keys()].join(',')}`;
  }

  private readonly logger = new Logger(TelegramAuthGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('tma ')) {
      throw new UnauthorizedException('Missing Telegram init data');
    }

    const initDataRaw = authHeader.slice('tma '.length);
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
    const allowUnsafe = process.env.ALLOW_UNSAFE_INIT_DATA === 'true';

    let parsed: ParsedInitData;
    try {
      validate(initDataRaw, botToken, { expiresIn: INIT_DATA_MAX_AGE_SECONDS });
      parsed = parse(initDataRaw) as unknown as ParsedInitData;
    } catch (err) {
      this.logger.warn(`initData rejected: ${this.describeRejection(initDataRaw, err)}`);
      if (!allowUnsafe) {
        // Shown to the customer as is, so it says what to do rather than what went wrong.
        throw new UnauthorizedException(
          isExpiredError(err)
            ? 'Сессия Telegram устарела. Закройте приложение полностью и откройте его заново.'
            : 'Приложение открыто не из бота магазина или из старой вкладки. Закройте его полностью и откройте через бота кнопкой «Каталог».',
        );
      }
      this.logger.warn(
        `⚠️ initData HMAC validation failed, falling back to UNSAFE unsigned parsing (ALLOW_UNSAFE_INIT_DATA=true). Reason: ${(err as Error).message}`,
      );
      try {
        parsed = parse(initDataRaw) as unknown as ParsedInitData;
      } catch (parseErr) {
        throw new UnauthorizedException('Malformed Telegram init data');
      }
    }

    if (!parsed.user) {
      throw new UnauthorizedException('Telegram init data missing user');
    }

    const telegramId = BigInt(parsed.user.id);
    const user = await this.prisma.user.upsert({
      where: { telegramId },
      update: {
        username: parsed.user.username,
        firstName: parsed.user.first_name,
        lastName: parsed.user.last_name,
      },
      create: {
        telegramId,
        username: parsed.user.username,
        firstName: parsed.user.first_name,
        lastName: parsed.user.last_name,
      },
    });

    (request as Request & { dbUser: typeof user }).dbUser = user;
    return true;
  }
}
