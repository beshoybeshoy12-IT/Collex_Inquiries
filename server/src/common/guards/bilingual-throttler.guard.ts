import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { Response } from 'express';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Rate limiting, with a message a human can act on.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The stock guard renders as **"ThrottlerException: Too Many Requests"** on
 *  the login screen. Three things are wrong with that, and all three were seen
 *  on a real sign-in attempt:
 *
 *    1. It is a CLASS NAME. "ThrottlerException" means nothing to the
 *       coordinator who mistyped their password twice.
 *    2. It is English only, in an application that is bilingual everywhere
 *       else — including on the very screen that renders it.
 *    3. It does not say WHAT TO DO. A rate limit the user cannot see the end
 *       of is indistinguishable from a broken login, and the reasonable
 *       response to a broken login is to keep clicking, which extends the
 *       block.
 *
 *  So this says how many seconds are left, in both languages, and sets
 *  `Retry-After` so a client can back off without scraping the text.
 *
 *  It does NOT relax the limit. The login throttle is a brute-force control;
 *  the point here is that being refused should be legible, not that it should
 *  happen less.
 */
@Injectable()
export class BilingualThrottlerGuard extends ThrottlerGuard {
  // An async method with no await is the base class signature here, not an
  // oversight: ThrottlerGuard declares Promise-returning overrides, and an
  // async method that throws returns the rejected promise the guard awaits.
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // `timeToExpire` is the window; `timeToBlockExpire` is set instead when a
    // route configures an explicit block. Whichever is live is the one the
    // caller is actually waiting on.
    const seconds = Math.max(
      1,
      Math.ceil(detail.timeToBlockExpire || detail.timeToExpire || 0),
    );

    if (context.getType() === 'http') {
      const response = context.switchToHttp().getResponse<Response>();
      // The header is what a well-behaved client backs off on. The text below
      // is for the person looking at the screen.
      response.setHeader('Retry-After', String(seconds));
    }

    // A plain HttpException rather than ThrottlerException: the latter's
    // constructor takes only a string and stringifies it, so there is no way to
    // attach `errorCode` or `retryAfterSeconds` through it. The exception
    // filter forwards every extra key on an object response, which is how the
    // client gets a countdown it can render without parsing the message.
    throw new HttpException(
      {
        message:
          `محاولات كثيرة. برجاء المحاولة بعد ${seconds} ثانية - ` +
          `Too many attempts. Please try again in ${seconds} seconds`,
        errorCode: 'RATE_LIMITED',
        retryAfterSeconds: seconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Also overridden because Nest calls this one when a route supplies its own
   * message, and a route that does so would otherwise bypass everything above.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async getErrorMessage(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<string> {
    const seconds = Math.max(
      1,
      Math.ceil(detail.timeToBlockExpire || detail.timeToExpire || 0),
    );
    return (
      `محاولات كثيرة. برجاء المحاولة بعد ${seconds} ثانية - ` +
      `Too many attempts. Please try again in ${seconds} seconds`
    );
  }
}
