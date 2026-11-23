import {
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { ProfileImageKind, ProfileService } from './profile.service';

/** Enum-shaped for ParseEnumPipe: the only two values the route accepts. */
const ImageKind = { avatar: 'avatar', cover: 'cover' } as const;

/**
 * `/api/v1/profile` — the caller's own profile images.
 *
 * Web users only (the default principal), and no permission: everyone may
 * change their own photo. There is no `:userId` anywhere in these routes —
 * the account is always the one in the token.
 */
@ApiTags('profile')
@ApiBearerAuth()
@Controller({ path: 'profile', version: '1' })
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Which profile images exist, with cache-busting versions' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.profile.summary(user);
  }

  @Get(':kind')
  @ApiOperation({ summary: 'The image bytes (JPEG, PNG or WebP)' })
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', new ParseEnumPipe(ImageKind)) kind: ProfileImageKind,
    @Res({ passthrough: true }) res: Response,
  ) {
    const image = await this.profile.read(user, kind);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Private: never in a shared cache. The client asks with a version in the
    // query string, so a long max-age is safe — a new upload is a new URL.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return new StreamableFile(image.buffer);
  }

  @Post(':kind')
  @UseInterceptors(
    // The hard ceiling at the parser, so an oversized body is cut off before
    // it is buffered. The per-kind limit is checked in the service.
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace the profile photo or cover' })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', new ParseEnumPipe(ImageKind)) kind: ProfileImageKind,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.profile.upload(user, kind, file);
  }

  @Delete(':kind')
  @ApiOperation({ summary: 'Remove the profile photo or cover' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', new ParseEnumPipe(ImageKind)) kind: ProfileImageKind,
  ) {
    return this.profile.remove(user, kind);
  }
}
