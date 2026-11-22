/**
 * The contract every push backend implements.
 *
 * Deliberately small, like `storage.driver.ts`, and for the same reason:
 * nothing provider-shaped may leak past it. No FCM message objects, no APNs
 * headers, no topic strings. A driver that is not configured says so through
 * `configured` rather than throwing at the call site, so the caller can record
 * an honest outcome instead of an exception.
 *
 * A driver reports per-token results rather than a single boolean because the
 * interesting failure is partial: two handsets registered, one of them
 * uninstalled the app. `UNREGISTERED` is the outcome that matters — it is the
 * provider telling us to stop trying, and the only outcome that changes stored
 * state.
 */

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Merged into the notification payload so the app can deep-link. */
  data?: Record<string, string>;
  /** `URGENT` asks the provider for a high-priority wake-up. */
  highPriority?: boolean;
}

export type PushOutcome =
  | 'SENT'
  /** The provider says this token is dead. Stop using it. */
  | 'UNREGISTERED'
  /** A transient failure — network, throttling, provider 5xx. Retryable. */
  | 'FAILED'
  /** No provider is configured. Not an error, and not a delivery either. */
  | 'SKIPPED';

export interface PushResult {
  token: string;
  outcome: PushOutcome;
  detail?: string;
}

export interface PushDriver {
  readonly name: string;

  /**
   * Whether this driver can actually reach a provider.
   *
   * Separate from `name` so `/readiness` and the delivery record can tell
   * "configured and failing" from "never configured", which are different
   * operational problems with different fixes.
   */
  readonly configured: boolean;

  /**
   * Deliver, and report what happened to each token.
   *
   * MUST NOT THROW for a per-message failure — return `FAILED` for that token.
   * Throwing is reserved for a fault that makes the whole batch meaningless,
   * and even then the caller catches it: a notification is never rolled back
   * because it could not be pushed.
   */
  send(messages: PushMessage[]): Promise<PushResult[]>;
}
