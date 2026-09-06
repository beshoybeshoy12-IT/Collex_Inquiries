import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PrincipalType } from '@prisma/client';
import type { Response } from 'express';
import { MediaService } from './media.service';
import {
  ConfirmUploadDto,
  DeleteMediaDto,
  MediaQueryDto,
  RequestUploadDto,
  UpsertMediaCategoryDto,
} from './dto/media.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/media`
 *
 * Both upload paths are here because a deployment may only have one of them:
 * `request-upload` + `confirm` is the production route (the bytes never touch
 * this process), and `upload` is the fallback for the local storage driver and
 * for small web-side uploads. The mobile client will use the presigned pair.
 */
@ApiTags('media')
@ApiBearerAuth()
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @RequirePermission(P.MEDIA_VIEW)
  @ApiOperation({ summary: 'List evidence for a case or a customer' })
  findAll(@TenantId() tenantId: string, @Query() query: MediaQueryDto) {
    return this.media.findAll(tenantId, query);
  }

  @Post('request-upload')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @RequirePermission(P.MEDIA_UPLOAD)
  @ApiOperation({
    summary: 'Reserve a row and get a presigned URL to PUT the file to',
  })
  requestUpload(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RequestUploadDto,
  ) {
    return this.media.requestUpload(tenantId, principal, dto);
  }

  @Post(':id/confirm')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @RequirePermission(P.MEDIA_UPLOAD)
  @ApiOperation({
    summary: 'Confirm a direct upload landed; verified against the bucket',
  })
  confirmUpload(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    return this.media.confirmUpload(tenantId, principal, id, dto);
  }

  @Post('upload')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @RequirePermission(P.MEDIA_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload through the API (checks magic bytes; used in development)',
  })
  uploadDirect(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: RequestUploadDto,
  ) {
    return this.media.uploadDirect(tenantId, principal, file, dto);
  }

  /**
   * Returns a short-lived URL, or streams the file when the storage driver
   * cannot sign one. Either way the access is audited.
   */
  @Get(':id/download')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @RequirePermission(P.MEDIA_DOWNLOAD)
  @ApiOperation({ summary: 'A time-limited download URL, or the bytes' })
  async download(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.media.downloadUrl(tenantId, principal, id);

    if (!result.streamThroughApi) return result;

    const file = await this.media.readBytes(tenantId, id);
    res.setHeader('Content-Type', file.mimeType);
    // `attachment` rather than `inline`: an uploaded HTML or SVG rendered on
    // this origin would be stored cross-site scripting.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, '')}"`,
    );
    res.send(file.buffer);
  }

  @Delete(':id')
  @RequirePermission(P.MEDIA_DELETE)
  @ApiOperation({
    summary: 'Soft-delete evidence on a case that is not approved',
  })
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteMediaDto,
  ) {
    return this.media.remove(tenantId, user, id, dto.reason);
  }

  // ── Categories ──────────────────────────────────────────────────────────

  @Get('categories/all')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'Configured evidence categories' })
  listCategories(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.media.listCategories(tenantId, activeOnly === 'true');
  }

  @Post('categories')
  @RequirePermission(P.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Add an evidence category' })
  createCategory(
    @TenantId() tenantId: string,
    @Body() dto: UpsertMediaCategoryDto,
  ) {
    return this.media.upsertCategory(tenantId, dto);
  }

  @Patch('categories/:id')
  @RequirePermission(P.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Edit an evidence category' })
  updateCategory(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertMediaCategoryDto,
  ) {
    return this.media.upsertCategory(tenantId, dto, id);
  }

  @Delete('categories/:id')
  @RequirePermission(P.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Delete a category, or deactivate it if in use' })
  removeCategory(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.media.removeCategory(tenantId, id);
  }
}
