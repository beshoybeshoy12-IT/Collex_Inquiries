import { Logger } from '@nestjs/common';
import {
  PushDriver,
  PushMessage,
  PushResult,
} from '../push.driver';

/**
 * The driver used when no push provider is configured.
 *
 * It records exactly what would have been sent, and returns `SKIPPED` for every
 * token. It never returns `SENT`.
 *
 * THAT DISTINCTION IS THE WHOLE POINT. A no-op that quietly reported success
 * would put `sent: 2` in the delivery record of a notification that reached
 * nobody, and the first time anyone checked whether push was working the answer
 * would be a confident lie. `SKIPPED` with a reason is the honest answer, and it
 * is what `/notifications` shows and what the logs say at boot.
 *
 * This is also the driver a developer wants: the log line proves the delivery
 * path ran, named the right recipient and found the right handsets, without
 * needing a Firebase project to test against.
 */
export class LogPushDriver implements PushDriver {
  readonly name = 'log';
  readonly configured = false;

  private readonly logger = new Logger('PushDriver');

  // Async to satisfy the interface; there is nothing to await.
  // eslint-disable-next-line @typescript-eslint/require-await
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    for (const message of messages) {
      this.logger.debug(
        `would push to ${redact(message.token)}: ` +
          `${JSON.stringify(message.title)} — ${JSON.stringify(message.body)}` +
          (message.highPriority ? ' [high priority]' : ''),
      );
    }

    return messages.map((message) => ({
      token: message.token,
      outcome: 'SKIPPED' as const,
      detail: 'no push provider configured (PUSH_DRIVER=none)',
    }));
  }
}

/**
 * A registration token identifies a handset and is a credential of sorts —
 * anyone holding it can be pushed to. Logs get shipped and read; the last six
 * characters are enough to correlate two lines without writing the whole thing
 * into a log aggregator.
 */
function redact(token: string): string {
  return token.length <= 6 ? '…' : `…${token.slice(-6)}`;
}
