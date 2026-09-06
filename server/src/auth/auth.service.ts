import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';

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

  updatePreferences(user: User, dto: UpdatePreferencesDto): Promise<User> {
    return this.prisma.user.update({
      where: { id: user.id },
      data: dto,
    });
  }
}
