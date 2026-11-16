import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import { CatalogService } from './catalog.service';
import { WebCatalogController } from './web-catalog.controller';
import { WebCatalogService } from './web-catalog.service';

@Module({
  controllers: [CatalogController, AdminCatalogController, WebCatalogController],
  providers: [CatalogService, WebCatalogService],
})
export class CatalogModule {}
