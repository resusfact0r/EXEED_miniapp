import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

class ContactDto {
  @IsInt()
  user_id!: number;

  @IsString()
  @MinLength(1)
  phone_number!: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;
}

/**
 * The client sends the `parsed` object from the Telegram SDK's `requestContactComplete()` /
 * `requestContact()` result. We trust it because this endpoint already sits behind
 * TelegramAuthGuard (the caller's initData was HMAC-validated), and we additionally check that
 * `contact.user_id` matches the authenticated session's telegramId before storing the phone.
 */
export class SubmitContactDto {
  @ValidateNested()
  @Type(() => ContactDto)
  contact!: ContactDto;
}
