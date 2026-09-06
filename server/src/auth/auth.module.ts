import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCacheService } from './auth-cache.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { PermissionResolverService } from './permission-resolver.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuditModule } from '../audit/audit.module';
import { requireEnv } from '../common/config/env';

/**
 * Global, because half the application needs one of these:
 * `AuthCacheService` (any mutation that changes a cached principal must evict
 * it), `PasswordService` (user and investigator creation) and
 * `PermissionResolverService` (recomputing after a role edit).
 *
 * Exporting them from one global module is what stops each feature module
 * re-importing `AuthModule` and, eventually, one of them growing its own
 * private copy of the eviction logic.
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      // Signing options are per-call in TokenService, because access and
      // refresh tokens have different lifetimes and only one of them is a JWT.
      secret: requireEnv('JWT_SECRET'),
    }),
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCacheService,
    PasswordService,
    TokenService,
    PermissionResolverService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    AuthCacheService,
    PasswordService,
    TokenService,
    PermissionResolverService,
    JwtAuthGuard,
    // Re-exported from a global module so `RealtimeGateway` can verify the
    // token presented on a socket handshake. The alternative — a second
    // `JwtModule.register` there — would be a second place the signing secret
    // is configured, and the two would eventually disagree.
    JwtModule,
  ],
})
export class AuthModule {}
