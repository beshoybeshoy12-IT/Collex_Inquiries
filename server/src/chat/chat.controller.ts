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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PrincipalType } from '@prisma/client';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import {
  ChatSettingsDto,
  MessagesQueryDto,
  OpenConversationDto,
  SendMessageDto,
} from './dto/chat.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedPrincipal,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';
import { MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE } from './chat.util';

/**
 * `/api/v1/chat` — internal one-to-one chat, for office staff and field
 * investigators alike (the same routes; the service decides what each sees).
 */
@ApiTags('chat')
@ApiBearerAuth()
@AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
@Controller({ path: 'chat', version: '1' })
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('contacts')
  @ApiOperation({ summary: 'People you may start a conversation with' })
  contacts(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query('search') search?: string,
  ) {
    return this.chat.contacts(principal, search);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Your conversations, newest first' })
  list(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.chat.list(principal);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Open (or start) a conversation with one person' })
  open(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: OpenConversationDto,
  ) {
    return this.chat.open(principal, { type: dto.type, id: dto.id });
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'A page of messages, oldest first' })
  messages(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.chat.messages(principal, id, query.before, query.limit);
  }

  @Post('conversations/:id/messages')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_MESSAGE, {
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_MESSAGE },
    }),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Send text and/or files' })
  send(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.chat.send(principal, id, dto.body, files);
  }

  @Post('conversations/:id/read')
  @ApiOperation({ summary: 'Mark the conversation read' })
  read(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.markRead(principal, id);
  }

  @Delete('messages/:id')
  @ApiOperation({ summary: 'Delete one of your own messages' })
  remove(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.deleteMessage(principal, id);
  }

  @Get('attachments/:id')
  @ApiOperation({ summary: 'A file sent in a conversation you are in' })
  async attachment(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.chat.attachment(principal, id);
    // Opaque bytes, no file name: never rendered on this origin, never grabbed
    // by a download manager. The client knows the type and name already.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.buffer);
  }

  @Get('unread')
  @ApiOperation({ summary: 'Total unread messages' })
  unread(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.chat.unreadTotal(principal);
  }

  @Get('settings')
  @AllowPrincipals(PrincipalType.WEB_USER)
  @ApiOperation({ summary: 'Chat retention' })
  settings(@TenantId() tenantId: string) {
    return this.chat.settings(tenantId);
  }

  @Patch('settings')
  @AllowPrincipals(PrincipalType.WEB_USER)
  @RequirePermission(P.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Set how long chat messages are kept' })
  updateSettings(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: ChatSettingsDto,
  ) {
    return this.chat.updateSettings(tenantId, principal, dto.retentionDays);
  }
}
