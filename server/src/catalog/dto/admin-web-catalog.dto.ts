import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_PRICE, MAX_STOCK, WAREHOUSE_CODE } from '../offers';

export class CardsQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
}

export class StoreOfferDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(MAX_PRICE) price!: number;
  @IsInt() @Min(0) @Max(MAX_STOCK) stockQty!: number;
}

export class EditCatalogCard {
  @IsString() @MinLength(1) @MaxLength(2000) name!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  originalArticles!: string[];
  @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) @MaxLength(2000, { each: true }) images!: string[];
  @IsOptional() @ValidateNested() @Type(() => StoreOfferDto) storeOffer?: StoreOfferDto;
  @IsOptional() @IsISO8601() version?: string;
}

export class NewCatalogCard extends EditCatalogCard {
  @IsString() @MinLength(1) @MaxLength(100) code!: string;
}

export class NewWarehouse {
  @Matches(WAREHOUSE_CODE) code!: string;
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(300) extraMarkup!: number;
  @IsInt() @Min(1) @Max(MAX_STOCK) defaultPackQty!: number;
  @IsOptional() @IsString() @MaxLength(100) brandFilter?: string;
}
