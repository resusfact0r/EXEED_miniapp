import { Module } from '@nestjs/common';

import { AdminWebCatalogController } from './admin-web-catalog.controller';
import { AdminWebCatalogService } from './admin-web-catalog.service';
import { CatalogController } from './catalog.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import { CatalogService } from './catalog.service';
import { WebCatalogController } from './web-catalog.controller';
import { WebCatalogService } from './web-catalog.service';

@Module({
  controllers: [CatalogController, AdminCatalogController, WebCatalogController, AdminWebCatalogController],
  providers: [CatalogService, WebCatalogService, AdminWebCatalogService],
})
export class CatalogModule {}
