import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

/**
 * Password hashing and the strength policy.
 *
 * Cost 12 is the deliberate figure: ~250 ms on the hardware this runs on,
 * which is slow enough to make an offline attack on a leaked hash expensive
 * and fast enough that a login does not feel broken. It is a constant rather
 * than an env var because an operator lowering it "to speed up login" is a
 * silent downgrade of everyone's stored credential, and there is no legitimate
 * reason to.
 */
const BCRYPT_ROUNDS = 12;

/** bcrypt silently truncates beyond 72 bytes; refusing is honest. */
const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LENGTH = 10;

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    this.assertAcceptable(plain);
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  /**
   * Compare a candidate against a stored hash.
   *
   * Never short-circuits on a missing hash: an account with no password must
   * take the same time to reject as one with, or the response time tells an
   * attacker which emails exist.
   */
  async verify(
    plain: string,
    hash: string | null | undefined,
  ): Promise<boolean> {
    if (!hash) {
      // A dummy comparison so the timing matches the real path.
      await bcrypt.compare(plain, DUMMY_HASH);
      return false;
    }
    return bcrypt.compare(plain, hash);
  }

  /**
   * The strength policy, applied on every set and change.
   *
   * Deliberately about length and variety rather than a battery of arbitrary
   * rules: a 10-character passphrase with three character classes resists
   * guessing far better than "P@ss1!" and is far likelier to be remembered
   * rather than written on a monitor in an operations room.
   */
  assertAcceptable(plain: string): void {
    const problems: string[] = [];

    if (!plain || plain.length < MIN_PASSWORD_LENGTH) {
      problems.push(
        `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف - ` +
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }

    if (Buffer.byteLength(plain ?? '', 'utf8') > MAX_PASSWORD_BYTES) {
      problems.push(
        'كلمة المرور طويلة جدًا - Password is too long (72 bytes maximum)',
      );
    }

    const classes = [
      /[a-z]/.test(plain ?? ''),
      /[A-Z]/.test(plain ?? ''),
      /[0-9]/.test(plain ?? ''),
      /[^a-zA-Z0-9]/.test(plain ?? ''),
    ].filter(Boolean).length;

    if (classes < 3) {
      problems.push(
        'كلمة المرور يجب أن تحتوي على ثلاثة أنواع على الأقل من الأحرف الكبيرة والصغيرة والأرقام والرموز - ' +
          'Password must mix at least three of: lowercase, uppercase, digits, symbols',
      );
    }

    if (COMMON_PASSWORDS.has((plain ?? '').toLowerCase())) {
      problems.push('كلمة المرور شائعة جدًا - This password is too common');
    }

    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }
  }

  /**
   * A password an administrator hands to a new user.
   *
   * Generated rather than chosen so that "create user" never involves an admin
   * inventing `Welcome123!` for the fortieth time. It always satisfies the
   * policy above by construction.
   */
  generate(length = 16): string {
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!@#$%^&*-_=+';
    const all = lower + upper + digits + symbols;

    // One of each guaranteed class first, then fill, then shuffle — so the
    // policy is met without the predictable "Aa1!" prefix that a naive
    // implementation leaves at the front of every generated password.
    const picks = [
      pick(lower),
      pick(upper),
      pick(digits),
      pick(symbols),
      ...Array.from({ length: Math.max(0, length - 4) }, () => pick(all)),
    ];

    for (let i = picks.length - 1; i > 0; i--) {
      const j = randomBytes(1)[0] % (i + 1);
      [picks[i], picks[j]] = [picks[j], picks[i]];
    }
    return picks.join('');
  }
}

function pick(alphabet: string): string {
  // Rejection sampling would be more correct; with alphabets this small the
  // modulo bias is under a fraction of a bit and these are not key material.
  return alphabet[randomBytes(1)[0] % alphabet.length];
}

/** A real bcrypt hash of a value nobody knows, for constant-time rejection. */
const DUMMY_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.eOaLp0kSXvhbUY5tE4Wq0F6Nn9lJm5S';

/**
 * The handful worth refusing outright. Not a substitute for a breach-corpus
 * check — it is the short list that shows up in every audit of a system like
 * this one, and blocking it costs nothing.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd!',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'administrator',
  'welcome123',
  'welcome1234',
  'letmein123',
  'collex1234',
  'p@ssw0rd12',
  'iloveyou12',
]);
