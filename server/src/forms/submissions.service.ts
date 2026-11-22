import {
  BadRequestException,
  ConflictException,
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
import {
  ChooseFormDto,
  SaveSubmissionDto,
  SubmitFormDto,
} from './dto/form.dto';
import { AuthenticatedPrincipal } from '../common/decorators/auth.decorators';

/**
 * When the office may type a paper form into a case: from assignment until the
 * investigator's work is handed in. Before assignment no form version is
 * pinned yet; once submitted, the answers are under review and changing them
 * there would change what QC is judging.
 */
const OFFICE_ENTRY_STATUSES: InvestigationStatus[] = [
  InvestigationStatus.ASSIGNED,
  InvestigationStatus.ACCEPTED,
  InvestigationStatus.EN_ROUTE,
  InvestigationStatus.ON_SITE,
  InvestigationStatus.IN_PROGRESS,
  InvestigationStatus.REWORK,
];

/**
 * When the office may change which form a case is answered on: any time before
 * the investigator's work is handed in. Once an attempt has been submitted the
 * form is part of the evidence, and a rework must be answered on the same one.
 */
const FORM_CHOICE_STATUSES: InvestigationStatus[] = [
  InvestigationStatus.NEW,
  InvestigationStatus.VALIDATING,
  InvestigationStatus.READY_FOR_ASSIGNMENT,
  ...OFFICE_ENTRY_STATUSES,
];

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
      templateId: form.templateId,
      nameAr: form.nameAr,
      nameEn: form.nameEn,
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

    return this.writeDraft(tenantId, investigationId, form.versionId, dto.answers);
  }

  /**
   * The office types in a paper form the investigator brought back.
   *
   * WHY THIS IS NOT `saveDraft`. That route is the investigator's, and it only
   * lets them touch their own case. Here the writer is a web user, so it goes
   * through the same visibility rule as every other case read (a coordinator
   * cannot fill in a case they cannot see), and it is held by
   * `investigations.edit` — the QC role deliberately lacks it, because the
   * person who checks the answers must not be the person who typed them.
   *
   * IT WRITES A DRAFT, NEVER A SUBMISSION, and it never moves the case. A
   * submitted attempt is evidence: if the latest attempt is SUBMITTED (the
   * case is in rework) a new draft attempt is opened beside it, exactly as the
   * investigator's own draft save does.
   *
   * Answers are not refused for being incomplete — a reviewer saves as they
   * go — but the problems a submission would hit are returned as `warnings`
   * so the screen can show them before anyone is surprised at submit time.
   */
  async saveOfficeAnswers(
    tenantId: string,
    investigationId: string,
    principal: AuthenticatedPrincipal,
    dto: SaveSubmissionDto,
  ) {
    const investigation = await this.investigations.assertVisible(
      tenantId,
      investigationId,
      principal,
    );

    if (!OFFICE_ENTRY_STATUSES.includes(investigation.status)) {
      throw new BadRequestException({
        message:
          'لا يمكن إدخال بيانات الاستمارة في هذه المرحلة؛ الاستعلام يجب أن يكون مُسندًا لباحث ولم يُسلَّم للمراجعة بعد - ' +
          'The form can only be entered while the case is with an investigator, before it goes to review',
        errorCode: 'FORM_ENTRY_NOT_OPEN',
        status: investigation.status,
      });
    }

    const form = await this.forms.schemaForInvestigation(
      tenantId,
      investigationId,
    );

    // Only keys the form asks for. A typo'd or stale key from the browser
    // would otherwise sit in the answers forever, rendered by nothing.
    const known = new Set(
      form.schema.sections.flatMap((s) => s.fields.map((f) => f.key)),
    );
    const answers = Object.fromEntries(
      Object.entries(dto.answers ?? {}).filter(([key]) => known.has(key)),
    );

    const submission = await this.writeDraft(
      tenantId,
      investigationId,
      form.versionId,
      answers,
    );

    await this.audit.log({
      tenantId,
      action: 'FORM_ANSWERS_ENTERED',
      category: 'FORM',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
      entityType: 'Investigation',
      entityId: investigationId,
      entityLabel: investigation.caseNumber,
      metadata: { attempt: submission.attempt, fields: Object.keys(answers).length },
    });

    return {
      submission,
      warnings: validateAnswers(form.schema, answers).problems,
    };
  }

  /**
   * Choose which form a case is answered on.
   *
   * A case gets its investigation type's form by default. The office can put
   * it on another — a work form on a case whose type defaults to residence —
   * and the choice is stored as the case's pinned `formVersionId`, so every
   * reader (the investigator's form, QC, the report) follows it without
   * knowing a choice was made. Assignment keeps an existing pin, so the
   * choice survives being assigned or reassigned.
   *
   * An unsubmitted DRAFT answers the old form's questions. It is never carried
   * across silently: the caller must say `discardDraft`, and the screen asks
   * the user first. A submitted attempt cannot be orphaned at all — the
   * status check refuses before that point.
   */
  async chooseForm(
    tenantId: string,
    investigationId: string,
    principal: AuthenticatedPrincipal,
    dto: ChooseFormDto,
  ) {
    const investigation = await this.investigations.assertVisible(
      tenantId,
      investigationId,
      principal,
    );

    if (!FORM_CHOICE_STATUSES.includes(investigation.status)) {
      throw new BadRequestException({
        message:
          'لا يمكن تغيير الاستمارة بعد تسليم الاستعلام - ' +
          'The form cannot be changed once the case has been submitted',
        errorCode: 'FORM_CHOICE_CLOSED',
        status: investigation.status,
      });
    }

    const template = await this.prisma.formTemplate.findFirst({
      where: { tenantId, id: dto.formTemplateId, isActive: true },
      select: { id: true, code: true, publishedVersionId: true },
    });
    if (!template?.publishedVersionId) {
      throw new NotFoundException(
        'لا يوجد إصدار منشور لهذا النموذج - This form has no published version',
      );
    }

    const submissions = await this.prisma.formSubmission.findMany({
      where: { tenantId, investigationId },
      select: { id: true, status: true, answers: true, formVersionId: true },
    });

    if (submissions.some((s) => s.status !== SubmissionStatus.DRAFT)) {
      throw new BadRequestException({
        message:
          'لا يمكن تغيير الاستمارة؛ يوجد تسليم سابق عليها - ' +
          'The form cannot be changed; a submission was already made on it',
        errorCode: 'FORM_CHOICE_CLOSED',
      });
    }

    const drafts = submissions.filter(
      (s) => s.formVersionId !== template.publishedVersionId,
    );
    const draftHasAnswers = drafts.some(
      (d) => Object.keys((d.answers ?? {}) as object).length > 0,
    );
    if (draftHasAnswers && !dto.discardDraft) {
      throw new ConflictException({
        message:
          'توجد بيانات مدخلة على الاستمارة الحالية وسيتم حذفها - ' +
          'Answers entered on the current form would be discarded',
        errorCode: 'FORM_DRAFT_HAS_ANSWERS',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      if (drafts.length > 0) {
        await tx.formSubmission.deleteMany({
          where: { tenantId, id: { in: drafts.map((d) => d.id) } },
        });
      }
      await tx.investigation.update({
        where: { id: investigationId },
        data: { formVersionId: template.publishedVersionId },
      });
    });

    await this.audit.log({
      tenantId,
      action: 'CASE_FORM_CHOSEN',
      category: 'FORM',
      actorType: principal.principalType,
      actorId: principal.id,
      actorName: principal.fullName,
      entityType: 'Investigation',
      entityId: investigationId,
      entityLabel: investigation.caseNumber,
      oldValue: { formVersionId: investigation.formVersionId },
      newValue: { formVersionId: template.publishedVersionId, form: template.code },
      metadata: { draftsDiscarded: drafts.length },
    });

    return this.getForInvestigation(tenantId, investigationId, principal);
  }

  /** Update the open draft, or open a new attempt as one. */
  private async writeDraft(
    tenantId: string,
    investigationId: string,
    formVersionId: string,
    answers: Record<string, unknown>,
  ) {
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
        data: { answers: answers as never },
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
        formVersionId,
        attempt: (lastAttempt._max.attempt ?? 0) + 1,
        status: SubmissionStatus.DRAFT,
        answers: answers as never,
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
      // The open draft, if any, IS this attempt — it was opened for it, by the
      // handset or by the office typing in the paper form. It becomes the
      // submission. Creating a fresh row under the same attempt number would
      // collide with the draft on the (investigationId, attempt) unique key;
      // with no draft, this is the next attempt after the last one.
      const draft = await tx.formSubmission.findFirst({
        where: { tenantId, investigationId, status: SubmissionStatus.DRAFT },
        orderBy: { attempt: 'desc' },
        select: { id: true },
      });

      // Everything else becomes history.
      await tx.formSubmission.updateMany({
        where: {
          tenantId,
          investigationId,
          status: { not: SubmissionStatus.SUPERSEDED },
          ...(draft ? { id: { not: draft.id } } : {}),
        },
        data: { status: SubmissionStatus.SUPERSEDED },
      });

      const submitted = {
        formVersionId: form.versionId,
        status: SubmissionStatus.SUBMITTED,
        answers: dto.answers as never,
        autoValidation: autoValidation as never,
        submittedByType: principal.principalType,
        submittedById: principal.id,
        submittedAt: new Date(),
        clientSubmissionId: dto.clientSubmissionId,
      };

      return draft
        ? tx.formSubmission.update({ where: { id: draft.id }, data: submitted })
        : tx.formSubmission.create({
            data: {
              ...submitted,
              tenantId,
              investigationId,
              attempt: (lastAttempt._max.attempt ?? 0) + 1,
            },
          });
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
