import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerLimitDetail } from '@nestjs/throttler';
import { BilingualThrottlerGuard } from './bilingual-throttler.guard';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The rate-limit refusal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  This exists because of what a real user saw on the login screen:
 *
 *      ThrottlerException: Too Many Requests
 *
 *  A class name, in English, in an application that is bilingual on that very
 *  screen, with no indication of how long to wait. The practical consequence is
 *  not cosmetic: a rate limit whose end the user cannot see is indistinguishable
 *  from a broken login, and the reasonable response to a broken login is to keep
 *  clicking — which is exactly what a brute-force control must not encourage.
 *
 *  The limit itself is unchanged. Only the refusal is legible.
 */
describe('BilingualThrottlerGuard', () => {
  const detail = (
    overrides: Partial<ThrottlerLimitDetail> = {},
  ): ThrottlerLimitDetail => ({
    totalHits: 6,
    timeToExpire: 43,
    isBlocked: true,
    timeToBlockExpire: 0,
    ttl: 60_000,
    limit: 5,
    key: 'k',
    tracker: '127.0.0.1',
    ...overrides,
  });

  const makeContext = () => {
    const response = { setHeader: jest.fn() };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ExecutionContext;
    return { context, response };
  };

  /** The guard needs no DI for the two methods under test. */
  const guard = () =>
    Object.create(
      BilingualThrottlerGuard.prototype,
    ) as BilingualThrottlerGuard & {
      throwThrottlingException(
        c: ExecutionContext,
        d: ThrottlerLimitDetail,
      ): Promise<void>;
      getErrorMessage(
        c: ExecutionContext,
        d: ThrottlerLimitDetail,
      ): Promise<string>;
    };

  const thrown = async (d: ThrottlerLimitDetail) => {
    const { context, response } = makeContext();
    try {
      await guard().throwThrottlingException(context, d);
    } catch (error) {
      return { error: error as HttpException, response };
    }
    throw new Error('the guard did not throw');
  };

  it('refuses with 429', async () => {
    const { error } = await thrown(detail());
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('never says "ThrottlerException"', async () => {
    // The regression this file exists for.
    const { error } = await thrown(detail());
    const body = error.getResponse() as { message: string };
    expect(body.message).not.toContain('ThrottlerException');
  });

  it('says it in Arabic and in English', async () => {
    const { error } = await thrown(detail());
    const body = error.getResponse() as { message: string };

    expect(body.message).toMatch(/[؀-ۿ]/); // Arabic
    expect(body.message).toMatch(/[A-Za-z]/); // English
    // ` - ` is the separator the client splits on to pick a half.
    expect(body.message.split(' - ')).toHaveLength(2);
  });

  it('names the wait, so the user knows this ends', async () => {
    const { error } = await thrown(detail({ timeToExpire: 43 }));
    const body = error.getResponse() as {
      message: string;
      retryAfterSeconds: number;
    };

    expect(body.message).toContain('43');
    expect(body.retryAfterSeconds).toBe(43);
  });

  it('sets Retry-After, so a client can back off without reading the text', async () => {
    const { response } = await thrown(detail({ timeToExpire: 43 }));
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '43');
  });

  it('carries a machine-readable code', async () => {
    const { error } = await thrown(detail());
    const body = error.getResponse() as { errorCode: string };
    expect(body.errorCode).toBe('RATE_LIMITED');
  });

  it('prefers an explicit block duration over the window', async () => {
    // A route configuring `blockDuration` is the value the caller is actually
    // waiting on; reporting the window instead would tell them to come back
    // too early.
    const { error } = await thrown(
      detail({ timeToExpire: 10, timeToBlockExpire: 300 }),
    );
    const body = error.getResponse() as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBe(300);
  });

  it('never advertises a zero-second wait', async () => {
    // "Try again in 0 seconds" reads as a bug, and a client that backs off for
    // zero retries instantly into the same refusal.
    const { error } = await thrown(
      detail({ timeToExpire: 0, timeToBlockExpire: 0 }),
    );
    const body = error.getResponse() as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('rounds a fractional wait up rather than down', async () => {
    const { error } = await thrown(detail({ timeToExpire: 12.3 }));
    const body = error.getResponse() as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBe(13);
  });

  it('gives the same bilingual text through getErrorMessage', async () => {
    // Nest calls this one on the path where a route supplies its own message;
    // if it were left stock, that path would leak the class name again.
    const { context } = makeContext();
    const message = await guard().getErrorMessage(context, detail());

    expect(message).not.toContain('ThrottlerException');
    expect(message).toMatch(/[؀-ۿ]/);
    expect(message).toMatch(/[A-Za-z]/);
  });
});
