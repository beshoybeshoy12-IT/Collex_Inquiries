import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContextService } from '../context/request-context';

/**
 * Opens the ambient request context for the whole request.
 *
 * This is middleware and not an interceptor on purpose. An interceptor's
 * `next.handle()` only *builds* an Observable; the route handler runs when
 * something subscribes to it, which happens after the interceptor has
 * returned — so an AsyncLocalStorage scope opened in an interceptor is already
 * closed by the time the handler needs it. Middleware calls `next()` inside the
 * scope, and everything downstream, guards and handler alike, inherits it.
 *
 * The context starts with no principal: middleware runs before the auth guard.
 * `JwtStrategy` fills that in through `setPrincipal()` once it knows who is
 * calling. Until it does, the context is present but unscoped, which is exactly
 * the state the tenant guard refuses to run a query in — so an endpoint that
 * somehow reached the database before authenticating fails loudly instead of
 * reading across tenants.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) || randomUUID();

    req.id = requestId;
    res.setHeader('x-request-id', requestId);

    this.requestContext.run(
      {
        tenantId: null,
        principalType: null,
        principalId: null,
        principalName: null,
        crossTenant: false,
        requestId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      () => next(),
    );
  }
}
