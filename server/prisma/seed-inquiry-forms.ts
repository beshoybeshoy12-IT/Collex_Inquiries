import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { validateFormSchema } from '../src/forms/form-schema';
import { INQUIRY_FORMS } from './seed-data/forms';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Install the residence and work inquiry forms into tenants that exist.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  `npm run db:inquiry-forms`                 every tenant
 *  `npm run db:inquiry-forms -- <tenant-code>`  one tenant
 *
 *  The demo seed only builds a tenant once, so a database seeded before these
 *  forms existed would never receive them. This does it without touching
 *  anything already answered:
 *
 *  - TEMPLATE MISSING → created, with v1 published.
 *  - TEMPLATE PRESENT, published schema different → a NEW version is
 *    published beside the old one. The old version is never edited: cases
 *    already assigned keep answering it, and only cases assigned from now on
 *    get the new one. That is the same rule the form builder follows.
 *  - TEMPLATE PRESENT, schema identical → nothing. Safe to re-run.
 *  - An open DRAFT on the template → skipped and reported. Someone is editing
 *    that form in the builder; publishing over their work is not ours to do.
 *
 *  The investigation type (RESIDENCE / WORKPLACE) is pointed at the template
 *  only when it has no form yet, so a tenant that has deliberately wired a
 *  different form keeps it. A tenant without the type is skipped: it does not
 *  run that kind of inquiry (the platform operator's own tenant, for one), and
 *  a form nothing can use is clutter in its builder.
 *
 *  Uses a plain PrismaClient, not the tenant-guarded one: it crosses tenants
 *  by design, the same way the seed does, and every write names its tenant.
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const form of INQUIRY_FORMS) validateFormSchema(form.schema);

  const code = process.argv[2];
  const tenants = await prisma.tenant.findMany({
    where: code ? { code } : {},
    select: { id: true, code: true },
  });

  if (tenants.length === 0) {
    throw new Error(code ? `No tenant with code "${code}"` : 'No tenants found');
  }

  for (const tenant of tenants) {
    for (const form of INQUIRY_FORMS) {
      const outcome = await installForm(tenant.id, form);
      console.log(`  ${tenant.code} · ${form.templateCode}: ${outcome}`);
    }
  }
}

async function installForm(
  tenantId: string,
  form: (typeof INQUIRY_FORMS)[number],
): Promise<string> {
  const type = await prisma.investigationType.findFirst({
    where: { tenantId, code: form.typeCode },
    select: { id: true },
  });
  if (!type) return `skipped — no ${form.typeCode} investigation type`;

  const existing = await prisma.formTemplate.findFirst({
    where: { tenantId, code: form.templateCode },
    include: { versions: { orderBy: { version: 'desc' } } },
  });

  let templateId: string;
  let outcome: string;

  if (!existing) {
    const created = await prisma.$transaction(async (tx) => {
      const template = await tx.formTemplate.create({
        data: {
          tenantId,
          code: form.templateCode,
          nameAr: form.nameAr,
          nameEn: form.nameEn,
          isActive: true,
          versions: {
            create: {
              tenantId,
              version: 1,
              isPublished: true,
              publishedAt: new Date(),
              schema: form.schema as never,
              changeNote: 'Inquiry form',
            },
          },
        },
        include: { versions: true },
      });
      return tx.formTemplate.update({
        where: { id: template.id },
        data: { publishedVersionId: template.versions[0].id },
      });
    });
    templateId = created.id;
    outcome = 'created v1';
  } else {
    templateId = existing.id;
    const published = existing.versions.find(
      (v) => v.id === existing.publishedVersionId,
    );
    const draft = existing.versions.find((v) => !v.isPublished);

    if (published && isDeepStrictEqual(published.schema, form.schema)) {
      outcome = `up to date (v${published.version})`;
    } else if (draft) {
      return `SKIPPED — draft v${draft.version} is open in the form builder; publish or delete it, then re-run`;
    } else {
      const next = (existing.versions[0]?.version ?? 0) + 1;
      await prisma.$transaction(async (tx) => {
        const version = await tx.formVersion.create({
          data: {
            tenantId,
            templateId,
            version: next,
            isPublished: true,
            publishedAt: new Date(),
            schema: form.schema as never,
            changeNote: 'Inquiry form (paper layout)',
          },
        });
        await tx.formTemplate.update({
          where: { id: templateId },
          data: {
            publishedVersionId: version.id,
            nameAr: form.nameAr,
            nameEn: form.nameEn,
          },
        });
      });
      outcome = `published v${next}`;
    }
  }

  const wired = await prisma.investigationType.updateMany({
    where: { tenantId, code: form.typeCode, formTemplateId: null },
    data: { formTemplateId: templateId },
  });
  if (wired.count > 0) outcome += `, wired to ${form.typeCode}`;

  return outcome;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
