import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';

import { TelegramAuthGuard } from '../common/guards/telegram-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { SubmitContactDto } from './dto/submit-contact.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

function toProfile(user: User) {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    hasPhone: Boolean(user.phone),
    hasConsent: Boolean(user.pdConsentAt),
    preferredFulfillmentType: user.preferredFulfillmentType,
    preferredDeliveryCarrier: user.preferredDeliveryCarrier,
    preferredPaymentMethod: user.preferredPaymentMethod,
  };
}

@Controller('auth')
@UseGuards(TelegramAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('session')
  session(@CurrentUser() user: User) {
    return toProfile(user);
  }

  @Post('phone')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async submitPhone(@CurrentUser() user: User, @Body() dto: SubmitContactDto) {
    const updated = await this.authService.savePhoneFromContact(user, dto);
    return toProfile(updated);
  }

  @Post('consent')
  async acceptConsent(@CurrentUser() user: User) {
    return toProfile(await this.authService.acceptConsent(user));
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return toProfile(user);
  }

  @Patch('preferences')
  async updatePreferences(@CurrentUser() user: User, @Body() dto: UpdatePreferencesDto) {
    const updated = await this.authService.updatePreferences(user, dto);
    return toProfile(updated);
  }
}
