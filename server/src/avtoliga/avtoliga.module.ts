import { Module } from '@nestjs/common';

import { AvtoligaService } from './avtoliga.service';

@Module({
  providers: [AvtoligaService],
  exports: [AvtoligaService],
})
export class AvtoligaModule {}
