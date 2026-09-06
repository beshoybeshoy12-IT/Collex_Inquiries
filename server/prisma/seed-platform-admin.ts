/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PasswordService } from '../src/auth/password.service';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The platform operator.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Creates the one account that can provision customer companies — the routes
 *  under `/api/v1/tenants` that `TenantsController.assertPlatformOperator`
 *  guards.
 *
 *  WHY THIS IS A SCRIPT AND NOT AN ENDPOINT.
 *
 *  `isSuperAdmin` is deliberately unreachable from the API. It is not a
 *  permission, and that is the whole point: a permission is a row somebody can
 *  grant, and "create companies" plus "raise your own plan limits" must not be
 *  grantable by a tenant administrator trying to be helpful. So the only way in
 *  is to run this against the database, which means shell access, which is the
 *  bar that should apply.
 *
 *  WHY IT IS SEPARATE FROM `seed.ts`.
 *
 *  That seeder's second half is demo data, and `docs/deployment.md` tells you
 *  to delete the demo tenant (or never seed it) before real users arrive. The
 *  operator has to exist in exactly the environment where the demo tenant must
 *  not, so the two cannot share a switch.
 *
 *  WHY THE OPERATOR GETS ITS OWN TENANT.
 *
 *  `User.tenantId` is required — there is no such thing as a user outside a
 *  company. Parking the operator inside DEMO would mean `onDelete: Cascade`
 *  destroys the only account that can create replacements the moment somebody
 *  follows the deployment checklist. So it lives in a company of its own that
 *  holds nothing else.
 *
 *  WHY IT HAS NO ROLE.
 *
 *  `PermissionsGuard` returns true for a super admin before it looks at any
 *  role, and `PermissionResolverService` answers with the entire catalogue.
 *  Attaching a role would imply the role governs this account. It does not, and
 *  editing that role later would look like it changed something.
 *
 *  THERE IS NO FALLBACK PASSWORD. `PLATFORM_ADMIN_PASSWORD` is required and is
 *  checked against the same policy the API applies, by calling the same class.
 *
 *  Idempotent. Re-running promotes and reactivates an existing account but
 *  leaves its password alone, so this is safe to put in a provisioning script.
 *  Set `PLATFORM_ADMIN_RESET=true` to rotate the password as well — the
 *  recovery path for an operator who has lost it.
 */

const prisma = new PrismaClient();
const passwords = new PasswordService();

/**
 * `??` alone is wrong here: `.env.example` ships these keys blank, and an empty
 * string is not undefined — it would sail past the fallback and create an
 * operator with no name, or look up a tenant whose code is "".
 */
function envOr(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value ? value : fallback;
}

const TENANT_CODE = envOr('PLATFORM_TENANT_CODE', 'PLATFORM').toUpperCase();
const EMAIL = envOr(
  'PLATFORM_ADMIN_EMAIL',
  'operator@collex.local',
).toLowerCase();
const NAME = envOr('PLATFORM_ADMIN_NAME', 'مشغّل المنصة / Platform Operator');
const RESET = process.env.PLATFORM_ADMIN_RESET === 'true';

async function main(): Promise<void> {
  console.log('\n═══ Collex Inquiries — platform operator ═══\n');

  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!password) {
    console.error(
      '✗ PLATFORM_ADMIN_PASSWORD is not set.\n\n' +
        '  This script will not invent one. An account that can create every\n' +
        '  company on the platform is the last place a default password\n' +
        '  belongs. Generate one and put it in server/.env:\n\n' +
        "    node -e \"console.log(require('crypto').randomBytes(18).toString('base64url'))\"\n",
    );
    process.exitCode = 1;
    return;
  }

  // The same policy the API enforces on every password change — called rather
  // than restated, so the two cannot drift apart.
  try {
    passwords.assertAcceptable(password);
  } catch (error) {
    const problems = (error as { response?: { message?: string[] } }).response
      ?.message;
    console.error('✗ PLATFORM_ADMIN_PASSWORD is not acceptable:\n');
    for (const problem of problems ?? [String(error)]) {
      console.error(`    · ${problem}`);
    }
    console.error('');
    process.exitCode = 1;
    return;
  }

  // ── The company that hosts the operator ──────────────────────────────────
  //
  // Not a customer. It is created ACTIVE with a far subscription end only so
  // that it reads honestly in the console; a super admin's own tenant status is
  // never checked — `assertTenantUsable` returns early for them.
  const tenant = await prisma.tenant.upsert({
    where: { code: TENANT_CODE },
    update: {},
    create: {
      code: TENANT_CODE,
      nameAr: 'إدارة المنصة',
      nameEn: 'Platform Operations',
      status: 'ACTIVE',
      defaultLocale: 'ar',
      timezone: 'Africa/Cairo',
      maxWebUsers: 5,
      maxInvestigators: 0,
      subscriptionStart: new Date(),
      subscriptionEnd: new Date('2099-12-31T00:00:00.000Z'),
      featureFlags: {},
    },
  });

  // ── The operator ─────────────────────────────────────────────────────────
  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: EMAIL } },
    select: { id: true, isSuperAdmin: true, status: true },
  });

  if (existing) {
    const rotate = RESET
      ? { passwordHash: await passwords.hash(password) }
      : {};

    await prisma.user.update({
      where: { id: existing.id },
      data: {
        isSuperAdmin: true,
        status: 'ACTIVE',
        deletedAt: null,
        // A locked-out operator with no other operator to unlock them is a
        // dead end, so re-running clears the lockout counters.
        failedLogins: 0,
        lockedUntil: null,
        ...rotate,
        ...(RESET ? { passwordChangedAt: new Date() } : {}),
      },
    });

    console.log(`○ ${EMAIL} already exists — promoted and reactivated.`);
    console.log(
      RESET
        ? '  Password ROTATED to PLATFORM_ADMIN_PASSWORD.'
        : '  Password left as it was. Set PLATFORM_ADMIN_RESET=true to rotate it.',
    );
  } else {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: EMAIL,
        fullName: NAME,
        passwordHash: await passwords.hash(password),
        // No role, on purpose — see the header.
        roleId: null,
        isSuperAdmin: true,
        status: 'ACTIVE',
        locale: 'ar',
        passwordChangedAt: new Date(),
      },
    });

    console.log(`✓ Created platform operator ${EMAIL}`);
  }

  const others = await prisma.user.count({
    where: { isSuperAdmin: true, deletedAt: null },
  });

  console.log(`
┌──────────────────────────────────────────────────────────────┐
│  PLATFORM OPERATOR READY                                     │
├──────────────────────────────────────────────────────────────┤
│  Company code : ${TENANT_CODE.padEnd(45)}│
│  Sign in at   : /login  (the same screen as everyone else)   │
│  Email        : ${EMAIL.padEnd(45)}│
│  Password     : PLATFORM_ADMIN_PASSWORD from your .env       │
│                                                              │
│  The console is at /platform/tenants and is visible only to  │
│  this account.                                               │
│                                                              │
│  Super-admin accounts on this database: ${String(others).padEnd(21)}│
└──────────────────────────────────────────────────────────────┘

  Unset PLATFORM_ADMIN_PASSWORD once you have signed in. It is not
  needed again, and an env file is a worse place to keep it than a
  password manager.
`);
}

main()
  .catch((error) => {
    console.error('\n✗ Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
