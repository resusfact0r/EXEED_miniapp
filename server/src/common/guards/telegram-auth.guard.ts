import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { validate, parse } from '@telegram-apps/init-data-node';

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
      if (!allowUnsafe) {
        throw new UnauthorizedException('Invalid Telegram init data');
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
