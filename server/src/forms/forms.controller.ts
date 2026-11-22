import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrincipalType } from '@prisma/client';
import { FormsService } from './forms.service';
import { SubmissionsService } from './submissions.service';
import {
  ChooseFormDto,
  CreateDraftDto,
  CreateFormTemplateDto,
  SaveFormVersionDto,
  SaveSubmissionDto,
  SubmitFormDto,
  UpdateFormTemplateDto,
} from './dto/form.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';
import { FIELD_TYPES, NAMED_PATTERNS } from './form-schema';

/**
 * `/api/v1/forms`
 *
 * Two audiences again: the builder routes belong to an administrator, and the
 * `investigation/:id` routes are what the field client uses to fetch its form
 * and submit answers. Both read the same `FormVersion`, which is the point.
 */
@ApiTags('forms')
@ApiBearerAuth()
@Controller({ path: 'forms', version: '1' })
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly submissions: SubmissionsService,
  ) {}

  /** What the builder palette can offer. Served, not hard-coded in the client. */
  @Get('field-types')
  @RequirePermission(P.FORMS_VIEW)
  @ApiOperation({ summary: 'Supported field types and validation patterns' })
  fieldTypes() {
    return {
      fieldTypes: FIELD_TYPES,
      patterns: Object.keys(NAMED_PATTERNS),
      conditionOperators: [
        'EQUALS',
        'NOT_EQUALS',
        'IN',
        'NOT_IN',
        'IS_EMPTY',
        'IS_NOT_EMPTY',
      ],
    };
  }

  @Get()
  @RequirePermission(P.FORMS_VIEW)
  @ApiOperation({ summary: 'List form templates with their versions' })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.forms.findAll(tenantId, activeOnly === 'true');
  }

  @Get(':id')
  @RequirePermission(P.FORMS_VIEW)
  @ApiOperation({ summary: 'One template with every version' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.findOne(tenantId, id);
  }

  @Get(':id/published')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'The version a new assignment would pin' })
  published(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forms.publishedVersion(tenantId, id);
  }

  @Post()
  @RequirePermission(P.FORMS_CREATE)
  @ApiOperation({ summary: 'Create a template with an empty draft v1' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFormTemplateDto,
  ) {
    return this.forms.create(tenantId, user, dto);
  }

  @Patch(':id')
  @RequirePermission(P.FORMS_EDIT)
  @ApiOperation({ summary: 'Rename or deactivate a template' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFormTemplateDto,
  ) {
    return this.forms.update(tenantId, id, dto);
  }

  @Post(':id/versions')
  @RequirePermission(P.FORMS_EDIT)
  @ApiOperation({ summary: 'Clone the published version into a new draft' })
  createDraft(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDraftDto,
  ) {
    return this.forms.createDraft(tenantId, id, user, dto.fromVersionId);
  }

  @Patch(':id/versions/:versionId')
  @RequirePermission(P.FORMS_EDIT)
  @ApiOperation({ summary: 'Save the draft schema; refused once published' })
  saveDraft(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: SaveFormVersionDto,
  ) {
    return this.forms.saveDraft(tenantId, id, versionId, dto);
  }

  @Post(':id/versions/:versionId/publish')
  @RequirePermission(P.FORMS_PUBLISH)
  @ApiOperation({
    summary: 'Publish a draft, freezing it for every case assigned afterwards',
  })
  publish(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.forms.publish(tenantId, id, versionId);
  }

  @Delete(':id/versions/:versionId')
  @RequirePermission(P.FORMS_DELETE)
  @ApiOperation({ summary: 'Delete an unused draft' })
  removeDraft(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.forms.removeDraft(tenantId, id, versionId);
  }

  // ── The field client routes ─────────────────────────────────────────────

  @Get('investigation/:investigationId')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @ApiOperation({
    summary: 'The pinned form for a case, plus any answers so far',
  })
  getForCase(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
  ) {
    return this.submissions.getForInvestigation(
      tenantId,
      investigationId,
      principal,
    );
  }

  @Get('investigation/:investigationId/history')
  @RequirePermission(P.QC_VIEW, P.INVESTIGATIONS_VIEW)
  @ApiOperation({ summary: 'Every submission attempt, newest first' })
  history(
    @TenantId() tenantId: string,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
  ) {
    return this.submissions.history(tenantId, investigationId);
  }

  @Patch('investigation/:investigationId/draft')
  @AllowPrincipals(PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'Save partial answers (mobile client)' })
  saveAnswers(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Body() dto: SaveSubmissionDto,
  ) {
    return this.submissions.saveDraft(
      tenantId,
      investigationId,
      principal,
      dto,
    );
  }

  @Put('investigation/:investigationId/form')
  @RequirePermission(P.INVESTIGATIONS_EDIT)
  @ApiOperation({
    summary: 'Choose which form the case is answered on (before submission)',
  })
  chooseForm(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Body() dto: ChooseFormDto,
  ) {
    return this.submissions.chooseForm(tenantId, investigationId, principal, dto);
  }

  @Patch('investigation/:investigationId/office')
  @RequirePermission(P.INVESTIGATIONS_EDIT)
  @ApiOperation({
    summary:
      'The office enters the paper form an investigator handed in (saved as a draft)',
  })
  saveOfficeAnswers(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Body() dto: SaveSubmissionDto,
  ) {
    return this.submissions.saveOfficeAnswers(
      tenantId,
      investigationId,
      principal,
      dto,
    );
  }

  @Post('investigation/:investigationId/submit')
  @AllowPrincipals(PrincipalType.INVESTIGATOR)
  @ApiOperation({
    summary: 'Submit the completed form for review (mobile client)',
  })
  submit(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Body() dto: SubmitFormDto,
  ) {
    return this.submissions.submit(tenantId, investigationId, principal, dto);
  }
}
