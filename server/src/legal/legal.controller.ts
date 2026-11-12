import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';

import { getBotUsername } from '../bot/telegram-api';
import { DOCUMENTS, renderDocument, type DocumentName } from './documents';
import { contactLine, getSeller, isSoleTrader } from './seller';
import { getSupportUsername } from './support';

/** Public on purpose: a privacy policy has to be readable without a Telegram session. */
@Controller('legal')
export class LegalController {
  @Get()
  async info() {
    const seller = getSeller();
    const support = getSupportUsername();
    if (!seller) {
      return { configured: false, seller: null, support };
    }
    const { bank: _bank, ...shown } = seller;
    return {
      configured: true,
      seller: { ...shown, ogrnLabel: isSoleTrader(seller) ? 'ОГРНИП' : 'ОГРН', contact: contactLine(seller, await getBotUsername()) },
      support,
    };
  }

  @Get(':document')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async document(@Param('document') document: string) {
    const seller = getSeller();
    if (!seller || !DOCUMENTS.includes(document as DocumentName)) {
      throw new NotFoundException();
    }
    return renderDocument(document as DocumentName, seller, await getBotUsername());
  }
}
