import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { importPriceList } from '../price-sync/import-price-list';
import { PrismaService } from '../prisma/prisma.service';
import { AdminWebCatalogService } from './admin-web-catalog.service';
import { CardsQuery, EditCatalogCard, NewCatalogCard, NewWarehouse } from './dto/admin-web-catalog.dto';
import { CENTRAL_WAREHOUSE, WAREHOUSE_CODE } from './offers';
import { WebCatalogService } from './web-catalog.service';

type Spreadsheet = { buffer: Buffer; originalname: string };
const spreadsheetForm = FileInterceptor('file', {
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1 },
});

function requireSpreadsheet(file?: Spreadsheet) {
  if (!file?.buffer.length || !/\.(csv|xlsx?)$/i.test(file.originalname)) {
    throw new BadRequestException('Выберите файл XLS, XLSX или CSV.');
  }
  return file;
}

@Controller('admin/catalog')
@UseGuards(AdminAuthGuard)
export class AdminWebCatalogController {
  constructor(
    private readonly service: AdminWebCatalogService,
    private readonly prisma: PrismaService,
    private readonly publicCatalog: WebCatalogService,
  ) {}

  @Get('cards') @Header('Cache-Control', 'no-store') cards(@Query() query: CardsQuery) {
    return this.service.cards(query);
  }

  @Post('cards') async create(@Body() dto: NewCatalogCard) {
    const card = await this.service.save(null, dto);
    this.publicCatalog.invalidate();
    return card;
  }

  @Put('cards/:id') async update(@Param('id') id: string, @Body() dto: EditCatalogCard) {
    const card = await this.service.save(id, dto);
    this.publicCatalog.invalidate();
    return card;
  }

  @Get('warehouses') @Header('Cache-Control', 'no-store') warehouses() {
    return this.service.warehouses();
  }

  @Post('warehouses') addWarehouse(@Body() dto: NewWarehouse) {
    return this.service.addWarehouse(dto);
  }

  @Get('imports') @Header('Cache-Control', 'no-store') imports() {
    return this.service.imports();
  }

  @Post('warehouses/:code/import')
  @UseInterceptors(spreadsheetForm)
  async importWarehouse(
    @Param('code') code: string,
    @UploadedFile() upload: Spreadsheet | undefined,
    @Body('snapshot') snapshot?: string,
  ) {
    if (
      !WAREHOUSE_CODE.test(code) ||
      (code !== CENTRAL_WAREHOUSE && !(await this.prisma.warehouse.findUnique({ where: { code } })))
    ) {
      throw new BadRequestException('Выберите склад.');
    }
    if (snapshot !== undefined && snapshot !== 'true' && snapshot !== 'false')
      throw new BadRequestException('Выберите режим загрузки.');
    const file = requireSpreadsheet(upload);
    const result = await importPriceList(
      this.prisma,
      file.buffer,
      {
        source: 'file',
        fileName: file.originalname.slice(0, 200),
      },
      { warehouseCode: code, snapshot: snapshot === 'true' },
    );
    if (result.status !== 'APPLIED') throw new BadRequestException(result.error ?? 'Файл не применён.');
    this.publicCatalog.invalidate();
    return result;
  }

  @Post('analogues/import')
  @UseInterceptors(spreadsheetForm)
  async importAnalogues(@UploadedFile() upload: Spreadsheet | undefined) {
    const result = await this.service.importAnalogs(requireSpreadsheet(upload).buffer);
    this.publicCatalog.invalidate();
    return result;
  }

  @Get('analogues.xlsx')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="analogues.xlsx"')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async exportAnalogues() {
    return new StreamableFile(await this.service.exportAnalogs());
  }
}
