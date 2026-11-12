import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';

import { callTelegram, getBotUsername } from '../bot/telegram-api';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitContactDto } from './dto/submit-contact.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async savePhoneFromContact(user: User, dto: SubmitContactDto): Promise<User> {
    if (BigInt(dto.contact.user_id) !== user.telegramId) {
      throw new UnauthorizedException('Contact does not belong to the authenticated user');
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data: { phone: dto.contact.phone_number },
    });
  }

  /**
   * Telegram's own in-app phone request crashed the whole Telegram client on the owner's phone,
   * so the number is asked for in the chat with the bot instead: a regular keyboard button with
   * request_contact, which every client supports. BotService.handleContact stores the answer.
   * `sent` is false when the bot can't write to the customer (they never pressed Start).
   */
  async requestPhoneInChat(user: User): Promise<{ sent: boolean; botUsername: string | null }> {
    const result = await callTelegram('sendMessage', {
      chat_id: user.telegramId.toString(),
      text: 'Нажмите кнопку ниже, чтобы поделиться номером телефона — он нужен для связи по заказам.',
      reply_markup: {
        keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return { sent: Boolean(result?.ok), botUsername: await getBotUsername() };
  }

  acceptConsent(user: User): Promise<User> {
    return this.prisma.user.update({ where: { id: user.id }, data: { pdConsentAt: new Date() } });
  }

  updatePreferences(user: User, dto: UpdatePreferencesDto): Promise<User> {
    return this.prisma.user.update({
      where: { id: user.id },
      data: dto,
    });
  }
}
