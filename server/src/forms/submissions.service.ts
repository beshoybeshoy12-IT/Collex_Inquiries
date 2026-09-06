import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestigationStatus,
  PrincipalType,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FormsService } from './forms.service';
import { InvestigationsService } from '../investigations/investigations.service';
import {
  validateAnswers,
  flattenFields,
  MEDIA_TYPES,
  FormSchema,
} from './form-schema';
import { SaveSubmissionDto, SubmitFormDto } from './dto/form.dto';
import { AuthenticatedPrincipal } from '../common/decorators/auth.decorators';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Form submissions.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  A REWORK NEVER OVERWRITES. Each attempt is its own row: attempt 1 is marked
 *  SUPERSEDED and attempt 2 is written beside it. QC can always see what was
 *  originally submitted, which is the difference between "this was corrected"
 *  and "this was always fine".
 *
 *  IDEMPOTENCY IS BUILT IN, because the client that calls this is going to be a
 *  phone on a bad connection. `clientSubmissionId` is unique per tenant, so a
 *  retried submission returns the first result instead of creating a second
 *  attempt — which is exactly the case the offline queue produces when a
 *  response is lost after the server has already committed.
 *
 *  AUTOMATIC VALIDATION runs here, synchronously, and its result is stored on
 *  the submission. It is the AUTO_VALIDATION stage of the workflow: required
 *  answers present, required photo categories present, GPS within range of the
 *  target. Failing it sends the case straight back to REWORK without occupying
 *  a QC officer.
 */
@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly forms: FormsService,
    private readonly investigations: InvestigationsService,
  ) {}

  /** The form to fill in, plus whatever has been answered so far. */
  async getForInvestigation(
    tenantId: string,
    investigationId: string,
    principal: AuthenticatedPrincipal,
  ) {
    await this.assertCanAnswer(tenantId, investigationId, principal, true);

    const form = await this.forms.schemaForInvestigation(
      tenantId,
      investigationId,
    );

    const current = await this.prisma.formSubmission.findFirst({
      where: {
        tenantId,
        investigationId,
        status: { not: SubmissionStatus.SUPERSEDED },
      },
      orderBy: { attempt: 'desc' },
    });

    return {
      formVersionId: form.versionId,
      version: form.version,
      schema: form.schema,
      submission: current,
    };
  }

  /**
   * Save a draft. Called repeatedly from the handset as the form is filled in,
   * so it must be cheap and must not validate — half a form is not an error.
   */
  async saveDraft(
    tenantId: string,
    investigationId: string,
    principal: AuthenticatedPrincipal,
    dto: SaveSubmissionDto,
  ) {
    await this.assertCanAnswer(tenantId, investigationId, principal, false);

    const form = await this.forms.schemaForInvestigation(
      tenantId,
      investigationId,
    );

    const open = await this.prisma.formSubmission.findFirst({
      where: {
        tenantId,
        investigationId,
        status: SubmissionStatus.DRAFT,
      },
      orderBy: { attempt: 'desc' },
    });

    if (open) {
      return this.prisma.formSubmission.update({
        where: { id: open.id },
        data: { answers: dto.answers as never },
      });
    }

    const lastAttempt = await this.prisma.formSubmission.aggregate({
      where: { tenantId, investigationId },
      _max: { attempt: true },
    });

    return this.prisma.formSubmission.create({
      data: {
        tenantId,
        investigationId,
        formVersionId: form.versionId,
        attempt: (lastAttempt._max.attempt ?? 0) + 1,
        status: SubmissionStatus.DRAFT,
        answers: dto.answers as never,
      },
    });
  }

  /**
   * Submit for review.
   *
   * Validates against the pinned schema, checks the evidence, runs the
   * automatic checks, moves the case, and — if the automatic checks fail —
   * sends it back without a human ever seeing it.
   */
  async submit(
    tenantId: string,
    investigationId: string,
    principal: AuthenticatedPrincipal,
    dto: SubmitFormDto,
  ) {
    const investigation = await this.assertCanAnswer(
      tenantId,
      investigationId,
      principal,
      false,
    );

    // A retry of a submission that already landed. Return the original rather
    // than creating a second attempt.
    if (dto.clientSubmissionId) {
      const previous = await this.prisma.formSubmission.findFirst({
        where: { tenantId, clientSubmissionId: dto.clientSubmissionId },
      });
      if (previous) {
        this.logger.log(
          `Duplicate submission ${dto.clientSubmissionId} ignored; returning attempt ${previous.attempt}`,
        );
        return {
          submission: previous,
          duplicate: true,
          autoValidation: previous.autoValidation,
        };
      }
    }

    const form = await this.forms.schemaForInvestigation(
      tenantId,
      investigationId,
    );

    const answerCheck = validateAnswers(form.schema, dto.answers);
    if (!answerCheck.valid) {
      throw new BadRequestException({
        message: 'النموذج غير مكتمل - The form is incomplete',
        errorCode: 'FORM_INCOMPLETE',
        problems: answerCheck.problems,
      });
    }

    const autoValidation = await this.runAutomaticChecks(
      tenantId,
      investigationId,
      form.schema,
      dto.answers,
    );

    const lastAttempt = await this.prisma.formSubmission.aggregate({
      where: { tenantId, investigationId },
      _max: { attempt: true },
    });

    const submission = await this.prisma.$transaction(async (tx) => {
      // Everything before this attempt becomes history.
      await tx.formSubmission.updateMany({
        where: {
          tenantId,
          investigationId,
          status: { not: SubmissionStatus.SUPERSEDED },
        },
        data: { status: SubmissionStatus.SUPERSEDED },
      });

      const created = await tx.formSubmission.create({
        data: {
          tenantId,
          investigationId,
          formVersionId: form.versionId,
          attempt: lastAttempt._max.attempt ?? 1,
          status: SubmissionStatus.SUBMITTED,
          answers: dto.answers as never,
          autoValidation: autoValidation as never,
          submittedByType: principal.principalType,
          submittedById: principal.id,
          submittedAt: new Date(),
          clientSubmissionId: dto.clientSubmissionId,
        },
      });

      return created;
    });

    // The case moves through the machine, never by direct assignment. The
    // investigator makes the first move; the remaining two have no human
    // behind them and go through the system path, so the timeline attributes
    // them to the system rather than to the investigator.
    await this.investigations.transition(tenantId, investigationId, principal, {
      status: InvestigationStatus.SUBMITTED,
      result: dto.result,
    });

    await this.investigations.systemTransition(
      tenantId,
      investigationId,
      InvestigationStatus.AUTO_VALIDATION,
      'Automatic completeness check',
    );

    if (autoValidation.passed) {
      await this.investigations.systemTransition(
        tenantId,
        investigationId,
        InvestigationStatus.QC_PENDING,
        'Automatic checks passed',
      );
    } else {
      await this.investigations.systemTransition(
        tenantId,
        investigationId,
        InvestigationStatus.REWORK,
        `Automatic checks failed: ${autoValidation.problems
          .map((p) => p.reasonEn)
          .join('; ')}`,
      );
    }

    await this.audit.log({
      tenantId,
      action: 'CASE_SUBMITTED',
      category: 'INVESTIGATION',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
      entityType: 'Investigation',
      entityId: investigationId,
      entityLabel: investigation.caseNumber,
      metadata: {
        attempt: submission.attempt,
        autoValidationPassed: autoValidation.passed,
      },
    });

    return { submission, duplicate: false, autoValidation };
  }

  /** Every attempt, newest first — what the QC screen's history tab shows. */
  async history(tenantId: string, investigationId: string) {
    return this.prisma.formSubmission.findMany({
      where: { tenantId, investigationId },
      orderBy: { attempt: 'desc' },
      include: {
        formVersion: { select: { id: true, version: true } },
      },
    });
  }

  /**
   * The automatic checks — the AUTO_VALIDATION stage.
   *
   * Deliberately mechanical: presence, counts and distance. Anything requiring
   * judgement is what QC is for, and a machine guessing at judgement produces
   * rejections nobody can act on.
   */
  private async runAutomaticChecks(
    tenantId: string,
    investigationId: string,
    schema: FormSchema,
    answers: Record<string, unknown>,
  ): Promise<{
    passed: boolean;
    checkedAt: string;
    problems: { check: string; reasonAr: string; reasonEn: string }[];
  }> {
    const problems: { check: string; reasonAr: string; reasonEn: string }[] =
      [];

    const investigation = await this.prisma.investigation.findFirstOrThrow({
      where: { tenantId, id: investigationId },
      select: {
        targetLat: true,
        targetLng: true,
        investigationType: { select: { requiredPhotoCategories: true } },
      },
    });

    // 1. Every media answer names an asset that exists, on this case, in this
    //    tenant. Without this a client could submit any UUID and the case would
    //    look complete with no photographs behind it.
    const mediaFields = flattenFields(schema).filter((f) =>
      MEDIA_TYPES.includes(f.type),
    );

    const referencedIds = mediaFields.flatMap((field) => {
      const value = answers[field.key];
      return (Array.isArray(value) ? value : value ? [value] : []).map(String);
    });

    if (referencedIds.length > 0) {
      const found = await this.prisma.mediaAsset.findMany({
        where: {
          tenantId,
          investigationId,
          id: { in: referencedIds },
          deletedAt: null,
        },
        select: { id: true },
      });
      const foundIds = new Set(found.map((m) => m.id));
      const missing = referencedIds.filter((id) => !foundIds.has(id));

      if (missing.length > 0) {
        problems.push({
          check: 'MEDIA_EXISTS',
          reasonAr: `${missing.length} مرفق مذكور في النموذج غير موجود`,
          reasonEn: `${missing.length} attachment(s) referenced by the form are missing`,
        });
      }
    }

    // 2. Required photo categories for this investigation type.
    const required = investigation.investigationType.requiredPhotoCategories;
    if (required.length > 0) {
      const present = await this.prisma.mediaAsset.findMany({
        where: {
          tenantId,
          investigationId,
          deletedAt: null,
          category: { code: { in: required } },
        },
        select: { category: { select: { code: true } } },
      });

      const haveCodes = new Set(
        present.map((m) => m.category?.code).filter(Boolean),
      );
      const missingCategories = required.filter((code) => !haveCodes.has(code));

      if (missingCategories.length > 0) {
        problems.push({
          check: 'REQUIRED_PHOTOS',
          reasonAr: `صور مطلوبة مفقودة: ${missingCategories.join(', ')}`,
          reasonEn: `Missing required photos: ${missingCategories.join(', ')}`,
        });
      }
    }

    // 3. A check-in within a sane distance of the address, when both are known.
    //    2 km, not 100 m: the target coordinates come from geocoding a
    //    hand-typed Egyptian address, and a tight radius would reject honest
    //    visits far more often than it would catch a dishonest one.
    if (investigation.targetLat && investigation.targetLng) {
      const checkIn = await this.prisma.gpsEvent.findFirst({
        where: { tenantId, investigationId, eventType: 'CHECK_IN' },
        orderBy: { recordedAt: 'desc' },
        select: { distanceFromTargetM: true },
      });

      if (!checkIn) {
        problems.push({
          check: 'GPS_CHECK_IN',
          reasonAr: 'لا يوجد تسجيل وصول للموقع',
          reasonEn: 'No GPS check-in was recorded at the address',
        });
      } else if (
        checkIn.distanceFromTargetM !== null &&
        checkIn.distanceFromTargetM > 2000
      ) {
        problems.push({
          check: 'GPS_DISTANCE',
          reasonAr: `تسجيل الوصول على بعد ${Math.round(checkIn.distanceFromTargetM / 1000)} كم من العنوان`,
          reasonEn: `Check-in was ${Math.round(checkIn.distanceFromTargetM / 1000)} km from the address`,
        });
      }
    }

    return {
      passed: problems.length === 0,
      checkedAt: new Date().toISOString(),
      problems,
    };
  }

  /**
   * The case must be one this principal may answer.
   *
   * An investigator may only answer their own current assignment. A web user
   * may read the form (for the QC screen) but the `readOnly` flag is what stops
   * them submitting on an investigator's behalf.
   */
  private async assertCanAnswer(
    tenantId: string,
    investigationId: string,
    principal: AuthenticatedPrincipal,
    readOnly: boolean,
  ) {
    const investigation = await this.prisma.investigation.findFirst({
      where: { tenantId, id: investigationId, deletedAt: null },
      select: {
        id: true,
        caseNumber: true,
        status: true,
        investigatorId: true,
      },
    });

    if (!investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    if (principal.principalType === PrincipalType.INVESTIGATOR) {
      if (investigation.investigatorId !== principal.id) {
        throw new NotFoundException(
          'التحقيق غير موجود - Investigation not found',
        );
      }
      return investigation;
    }

    if (!readOnly) {
      throw new BadRequestException(
        'النموذج يُملأ بواسطة الباحث الميداني فقط - ' +
          'Only the assigned field investigator can fill in this form',
      );
    }

    return investigation;
  }
}
