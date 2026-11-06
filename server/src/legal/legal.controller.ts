import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';

import { DOCUMENTS, renderDocument, type DocumentName } from './documents';
import { getSeller } from './seller';

/** Public on purpose: a privacy policy has to be readable without a Telegram session. */
@Controller('legal')
export class LegalController {
  @Get()
  info() {
    const seller = getSeller();
    return { configured: Boolean(seller), seller };
  }

  @Get(':document')
  @Header('Content-Type', 'text/html; charset=utf-8')
  document(@Param('document') document: string) {
    const seller = getSeller();
    if (!seller || !DOCUMENTS.includes(document as DocumentName)) {
      throw new NotFoundException();
    }
    return renderDocument(document as DocumentName, seller);
  }
}
