import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';

import { TelegramAuthGuard } from '../common/guards/telegram-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { SubmitContactDto } from './dto/submit-contact.dto';

function toProfile(user: User) {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    hasPhone: Boolean(user.phone),
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
  async submitPhone(@CurrentUser() user: User, @Body() dto: SubmitContactDto) {
    const updated = await this.authService.savePhoneFromContact(user, dto);
    return toProfile(updated);
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return toProfile(user);
  }
}
