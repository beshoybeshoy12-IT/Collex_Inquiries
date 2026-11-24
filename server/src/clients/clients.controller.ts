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
  StreamableFile,
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
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/clients` — the banks and companies ("الجهات") and their templates.
 *
 * The logo is readable by any office user, not only `clients.view`: whoever
 * may print a case's form needs the logo printed on it.
 */
@ApiTags('clients')
@ApiBearerAuth()
@AllowPrincipals(PrincipalType.WEB_USER)
@Controller({ path: 'clients', version: '1' })
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermission(P.CLIENTS_VIEW, P.INVESTIGATIONS_VIEW, P.IMPORTS_VIEW)
  @ApiOperation({ summary: 'Clients, active first' })
  list(
    @TenantId() tenantId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.clients.list(tenantId, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermission(P.CLIENTS_VIEW)
  @ApiOperation({ summary: 'One client with its template' })
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(tenantId, id);
  }

  @Post()
  @RequirePermission(P.CLIENTS_MANAGE)
  @ApiOperation({ summary: 'Add a client' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClientDto,
  ) {
    return this.clients.create(tenantId, user, dto);
  }

  @Patch(':id')
  @RequirePermission(P.CLIENTS_MANAGE)
  @ApiOperation({ summary: 'Edit a client, its template, or archive it' })
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clients.update(tenantId, user, id, dto);
  }

  @Get(':id/template')
  @RequirePermission(P.CLIENTS_VIEW)
  @ApiOperation({ summary: "Download the client's blank inquiry file" })
  async template(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lang') lang: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const language =
      lang === 'en' || lang === 'ar'
        ? lang
        : user.locale === 'en'
          ? 'en'
          : 'ar';
    const { buffer } = await this.clients.template(tenantId, id, language);
    // Opaque bytes and no file name: a desktop download manager would grab an
    // xlsx attachment and leave the page an empty reply. The client names it.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(buffer);
  }

  @Get(':id/logo')
  @ApiOperation({ summary: 'The logo bytes (PNG, JPEG or WebP)' })
  async logo(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const image = await this.clients.readLogo(tenantId, id);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The client asks with the logo's version in the query string, so a new
    // upload is a new URL and a long private max-age is safe.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return new StreamableFile(image.buffer);
  }

  @Post(':id/logo')
  @RequirePermission(P.CLIENTS_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace the logo' })
  uploadLogo(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.clients.uploadLogo(tenantId, user, id, file);
  }

  @Delete(':id/logo')
  @RequirePermission(P.CLIENTS_MANAGE)
  @ApiOperation({ summary: 'Remove the logo' })
  removeLogo(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.clients.removeLogo(tenantId, user, id);
  }
}
