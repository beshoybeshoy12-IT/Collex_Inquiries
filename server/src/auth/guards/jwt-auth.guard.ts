import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PUBLIC_KEY } from '../../common/decorators/auth.decorators';

/**
 * Authentication for every route.
 *
 * Registered globally in `app.module.ts`, before `PermissionsGuard`, so the
 * principal is on the request by the time permissions are checked. A route
 * opts out with `@Public()` — and only login, refresh and the health probes
 * do.
 *
 * Defaulting to protected is the point: a new controller written by someone
 * who did not think about auth is closed, and the failure shows up on their
 * first request rather than in an audit.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;
    return super.canActivate(context);
  }
}
