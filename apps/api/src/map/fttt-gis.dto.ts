import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class FtttPlanningRatesDto {
  @IsNumber()
  @Min(0.1)
  @Max(2000)
  poleSpacingMeters!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  cableSlackRatio!: number;

  @IsNumber()
  @Min(1)
  manholeSpacingMeters!: number;

  @IsNumber()
  @Min(1)
  handholeSpacingMeters!: number;

  @IsNumber()
  @Min(0)
  splicesPerManhole!: number;

  @IsNumber()
  @Min(0)
  splicesPerTowerEnd!: number;

  @IsNumber()
  @Min(0)
  costPerMeterCableIdr!: number;

  @IsNumber()
  @Min(0)
  costPerManholeIdr!: number;

  @IsNumber()
  @Min(0)
  costPerHandholeIdr!: number;

  @IsNumber()
  @Min(0)
  costPerSpliceIdr!: number;

  @IsNumber()
  @Min(0)
  costPerPoleIdr!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  waterCrossingSurchargeIdr?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  waterSetbackMeters?: number;
}

export class CalculateFtttDto {
  @IsIn(['RADIUS', 'POLYGON'])
  areaMethod!: 'RADIUS' | 'POLYGON';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50000)
  radiusMeters?: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLon?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  polygon?: number[][];

  @IsString()
  @MinLength(1)
  startTowerId!: string;

  @IsString()
  @MinLength(1)
  destTowerId!: string;

  @ValidateNested()
  @Type(() => FtttPlanningRatesDto)
  rates!: FtttPlanningRatesDto;
}

export class UpsertGisTowerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsIn(['EXISTING', 'ON_PROGRESS', 'PLANNING'])
  status?: 'EXISTING' | 'ON_PROGRESS' | 'PLANNING';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateGisTowerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsIn(['EXISTING', 'ON_PROGRESS', 'PLANNING'])
  status!: 'EXISTING' | 'ON_PROGRESS' | 'PLANNING';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
