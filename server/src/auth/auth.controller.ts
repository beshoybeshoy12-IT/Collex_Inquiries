import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrincipalType } from '@prisma/client';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import {
  AllowPrincipals,
  CurrentUser,
  Public,
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import {
  ChangePasswordDto,
  InvestigatorLoginDto,
  LoginDto,
  RefreshTokenDto,
} from './dto/auth.dto';

/**
 * `/api/v1/auth`
 *
 * Sign-in is throttled far harder than the global 200/min: five attempts a
 * minute per IP is generous for a human and useless for credential stuffing.
 * The lockout in `AuthService` protects one account; this protects the endpoint
 * from someone spraying one password across every account instead, which no
 * per-account counter can see.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private origin(req: Request) {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in as a web platform user' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.origin(req));
  }

  /**
   * The future mobile application's entry point. Present now because the whole
   * investigator side of the data model is built and testable without it, and
   * because leaving it out would mean changing the auth contract later — which
   * is exactly what the brief asks not to happen.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('investigator/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in as a field investigator (mobile client)' })
  investigatorLogin(@Body() dto: InvestigatorLoginDto, @Req() req: Request) {
    return this.auth.investigatorLogin(dto, this.origin(req));
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * Public because the access token has by definition expired by the time a
   * client calls this; the refresh token is the credential. Rate-limited
   * because a valid-looking refresh token is worth brute-forcing.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.origin(req));
  }

  @ApiBearerAuth()
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the current session' })
  logout(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.logout(principal);
  }

  @ApiBearerAuth()
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End every session on every device' })
  logoutAll(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.logoutAll(principal);
  }

  @ApiBearerAuth()
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @Get('sessions')
  @ApiOperation({ summary: 'List the caller’s own live sessions' })
  sessions(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.listSessions(principal.id, principal.tenantId);
  }

  @ApiBearerAuth()
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change your own password' })
  changePassword(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(principal, dto);
  }

  /**
   * Who am I, with my effective permissions.
   *
   * The client calls this on boot rather than trusting the permission list it
   * cached at login — that snapshot goes stale the moment an administrator
   * edits a role, and a UI gated on a stale list shows buttons that 403.
   */
  @ApiBearerAuth()
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @Get('me')
  @ApiOperation({ summary: 'The current principal and its permissions' })
  me(@CurrentUser() principal: AuthenticatedPrincipal) {
    // Destructured out, never returned: the token id exists for revocation.
    const { jti: _jti, ...safe } = principal as AuthenticatedUser & {
      jti?: string;
    };
    return safe;
  }
}
