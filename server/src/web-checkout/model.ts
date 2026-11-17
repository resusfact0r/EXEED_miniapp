import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class Line {
  @IsString() @MinLength(1) @MaxLength(100) code!: string;
  @IsInt() @Min(1) @Max(100000) quantity!: number;
}
export class Checkout {
  @IsString() @Matches(/^\S.{0,98}\S$/u) name!: string;
  @Matches(/^\+7\d{10}$/) phone!: string;
  @IsBoolean() exactArticle!: boolean;
  @IsOptional() @Matches(/^[A-HJ-NPR-Z0-9]{17}$/) vin?: string;
  @IsIn(['pickup','cdek']) method!: string;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) city?: number;
  @IsOptional() @Matches(/^[A-Z0-9_-]{1,40}$/i) point?: string;
  @Equals(true) consent!: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each:true }) @Type(()=>Line) lines!: Line[];
}
export class Parcel {
  @IsInt() @Min(1) @Max(1000000) weight!: number;
  @IsInt() @Min(1) @Max(1000) width!: number;
  @IsInt() @Min(1) @Max(1000) height!: number;
  @IsInt() @Min(1) @Max(1000) length!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsInt({each:true}) @Min(1,{each:true}) @Max(1000000,{each:true}) itemGrams!: number[];
}
export class Approval {
  @Equals(true) confirmed!: boolean;
  @IsOptional() @ValidateNested() @Type(()=>Parcel) parcel?: Parcel;
}
export class PaymentConsent {
  @IsInt() @Min(1) @Max(2147483647) totalCents!: number;
}
export type Item = {code:string;name:string;quantity:number;cents:number};
