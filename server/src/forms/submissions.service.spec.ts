import { BadRequestException } from '@nestjs/common';
import {
  InvestigationStatus,
  PrincipalType,
  SubmissionStatus,
} from '@prisma/client';
import { SubmissionsService } from './submissions.service';
import { RESIDENCE_FORM_SCHEMA } from '../../prisma/seed-data/forms';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The office typing in a paper form, and what happens when it is submitted
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Two things are pinned here:
 *
 *  1. The office writes DRAFTS, only while the case is with an investigator,
 *     and only keys the form actually asks for.
 *
 *  2. Submitting a case that has an open draft turns THAT draft into the
 *     submission. The draft holds an attempt number; creating a second row
 *     under the same number hits the (investigationId, attempt) unique key
 *     and the submission fails. Before the office could write drafts that was
 *     an edge case; now it is the normal path.
 */
describe('SubmissionsService', () => {
  const tenantId = 't1';
  const caseId = 'c1';

  const webUser = {
    id: 'u1',
    principalType: PrincipalType.WEB_USER,
    fullName: 'Reviewer',
  } as never;

  const investigator = {
    id: 'i1',
    principalType: PrincipalType.INVESTIGATOR,
    fullName: 'Investigator',
  } as never;

  let prisma: Record<string, Record<string, jest.Mock>> & {
    $transaction: jest.Mock;
  };
  let investigations: Record<string, jest.Mock>;
  let service: SubmissionsService;

  beforeEach(() => {
    prisma = {
      formSubmission: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }) => ({ attempt: 1, ...data })),
        create: jest.fn().mockImplementation(({ data }) => data),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { attempt: null } }),
      },
      investigation: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          caseNumber: 'CASE-1',
          status: InvestigationStatus.IN_PROGRESS,
          investigatorId: 'i1',
        }),
        update: jest.fn(),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          targetLat: null,
          targetLng: null,
          investigationType: { requiredPhotoCategories: [] },
        }),
      },
      mediaAsset: { findMany: jest.fn().mockResolvedValue([]) },
      formTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'work',
          code: 'WORKPLACE_FORM',
          publishedVersionId: 'v-work',
        }),
      },
      gpsEvent: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    } as never;
    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );

    investigations = {
      assertVisible: jest.fn().mockResolvedValue({
        id: caseId,
        caseNumber: 'CASE-1',
        status: InvestigationStatus.ASSIGNED,
      }),
      transition: jest.fn(),
      systemTransition: jest.fn(),
    };

    const forms = {
      schemaForInvestigation: jest.fn().mockResolvedValue({
        versionId: 'v1',
        version: 1,
        schema: RESIDENCE_FORM_SCHEMA,
      }),
    };

    service = new SubmissionsService(
      prisma as never,
      { log: jest.fn() } as never,
      forms as never,
      investigations as never,
    );
  });

  describe('saveOfficeAnswers', () => {
    it('opens a draft attempt and keeps only the form’s own keys', async () => {
      const result = await service.saveOfficeAnswers(tenantId, caseId, webUser, {
        answers: { propertyType: 'HOUSE', notAField: 'x' },
      });

      expect(prisma.formSubmission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: SubmissionStatus.DRAFT,
          attempt: 1,
          formVersionId: 'v1',
          answers: { propertyType: 'HOUSE' },
        }),
      });
      expect(result.warnings).toEqual([]);
    });

    it('updates the open draft rather than opening another', async () => {
      prisma.formSubmission.findFirst.mockResolvedValue({ id: 'd1' });

      await service.saveOfficeAnswers(tenantId, caseId, webUser, {
        answers: { carAccess: 'YES' },
      });

      expect(prisma.formSubmission.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { answers: { carAccess: 'YES' } },
      });
      expect(prisma.formSubmission.create).not.toHaveBeenCalled();
    });

    it('returns problems as warnings instead of refusing the save', async () => {
      const result = await service.saveOfficeAnswers(tenantId, caseId, webUser, {
        answers: { propertyType: 'CASTLE' },
      });
      expect(result.warnings.map((w) => w.field)).toEqual(['propertyType']);
    });

    it.each([
      InvestigationStatus.READY_FOR_ASSIGNMENT,
      InvestigationStatus.QC_PENDING,
      InvestigationStatus.COMPLETED,
    ])('refuses while the case is %s', async (status) => {
      investigations.assertVisible.mockResolvedValue({
        id: caseId,
        caseNumber: 'CASE-1',
        status,
      });

      await expect(
        service.saveOfficeAnswers(tenantId, caseId, webUser, { answers: {} }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.formSubmission.create).not.toHaveBeenCalled();
    });

    it('goes through the case visibility rule', async () => {
      investigations.assertVisible.mockRejectedValue(new Error('404'));
      await expect(
        service.saveOfficeAnswers(tenantId, caseId, webUser, { answers: {} }),
      ).rejects.toThrow('404');
    });
  });

  describe('submit', () => {
    it('turns the open draft into the submission, keeping its attempt', async () => {
      prisma.formSubmission.findFirst.mockImplementation(({ where }) =>
        where.status === SubmissionStatus.DRAFT ? { id: 'd1' } : null,
      );
      prisma.formSubmission.aggregate.mockResolvedValue({ _max: { attempt: 2 } });

      await service.submit(tenantId, caseId, investigator, { answers: {} });

      expect(prisma.formSubmission.create).not.toHaveBeenCalled();
      expect(prisma.formSubmission.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: expect.objectContaining({ status: SubmissionStatus.SUBMITTED }),
      });
      // Everything except the draft is superseded.
      expect(prisma.formSubmission.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: { not: 'd1' } }),
        data: { status: SubmissionStatus.SUPERSEDED },
      });
    });

    it('opens the next attempt when there is no draft', async () => {
      prisma.formSubmission.aggregate.mockResolvedValue({ _max: { attempt: 2 } });

      await service.submit(tenantId, caseId, investigator, { answers: {} });

      expect(prisma.formSubmission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attempt: 3,
          status: SubmissionStatus.SUBMITTED,
        }),
      });
    });
  });

  describe('chooseForm', () => {
    const choose = (extra = {}) =>
      service.chooseForm(tenantId, caseId, webUser, {
        formTemplateId: 'work',
        ...extra,
      });

    it('pins the chosen form’s published version on the case', async () => {
      await choose();
      expect(prisma.investigation.update).toHaveBeenCalledWith({
        where: { id: caseId },
        data: { formVersionId: 'v-work' },
      });
    });

    it('refuses to drop typed-in answers without being told to', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([
        { id: 'd1', status: 'DRAFT', formVersionId: 'v-res', answers: { carAccess: 'YES' } },
      ]);
      await expect(choose()).rejects.toMatchObject({ status: 409 });
      expect(prisma.investigation.update).not.toHaveBeenCalled();

      await choose({ discardDraft: true });
      expect(prisma.formSubmission.deleteMany).toHaveBeenCalledWith({
        where: { tenantId, id: { in: ['d1'] } },
      });
    });

    it('never orphans a submitted attempt', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([
        { id: 's1', status: 'SUPERSEDED', formVersionId: 'v-res', answers: {} },
      ]);
      await expect(choose({ discardDraft: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('is closed once the case is under review', async () => {
      investigations.assertVisible.mockResolvedValue({
        id: caseId,
        caseNumber: 'CASE-1',
        status: InvestigationStatus.QC_PENDING,
      });
      await expect(choose()).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
