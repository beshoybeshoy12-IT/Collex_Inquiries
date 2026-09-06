import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

/**
 * Paging, sorting and free-text search, shared by every list endpoint.
 *
 * `limit` is capped at 200. The cap is the point: without it a client asking
 * for `limit=100000` turns a paginated endpoint into a full table scan that
 * serialises every case in the tenant, and the first time anybody notices is
 * when the database falls over. A caller who genuinely wants everything is
 * asking for an export, which is a queued job.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 25;

  @ApiPropertyOptional({
    description: 'Free-text search across indexed fields.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ description: 'Column to sort by.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  /**
   * Turn `sortBy` into a Prisma `orderBy`, refusing anything not on the
   * allow-list.
   *
   * The allow-list is not decoration. `sortBy` arrives from the query string,
   * and Prisma will happily order by a relation path — so an unchecked value
   * lets a caller sort by `customer.nationalId` and read a column they have no
   * permission to see, one binary-search request at a time.
   */
  orderBy(
    allowed: readonly string[],
    fallback: string,
  ): Record<string, 'asc' | 'desc'> {
    const column =
      this.sortBy && allowed.includes(this.sortBy) ? this.sortBy : fallback;
    return { [column]: this.sortOrder };
  }
}
