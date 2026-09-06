import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssignmentStatus, PrincipalType } from '@prisma/client';
import { AssignmentsService } from './assignments.service';
import {
  AssignDto,
  BulkAssignDto,
  ReassignDto,
  RespondToAssignmentDto,
  SuggestQueryDto,
} from './dto/assignment.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedInvestigator,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/assignments`
 *
 * Two audiences on one controller. The office routes create assignments and
 * need `investigations.assign`; the two `my-*` routes are the field
 * investigator's, and the future mobile application calls exactly those.
 *
 * Keeping them together rather than duplicating a mobile controller is the
 * point of the brief's "do not create a separate duplicated business logic
 * layer for mobile" — there is one assignment service, and the principal type
 * decides which door you came in by.
 */
@ApiTags('assignments')
@ApiBearerAuth()
@Controller({ path: 'assignments', version: '1' })
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post()
  @RequirePermission(P.INVESTIGATIONS_ASSIGN)
  @ApiOperation({ summary: 'Assign one case to a field investigator' })
  assign(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssignDto,
  ) {
    return this.assignments.assign(tenantId, user, dto);
  }

  @Post('bulk')
  @RequirePermission(P.INVESTIGATIONS_ASSIGN)
  @ApiOperation({
    summary: 'Assign many cases at once; reports what it could not assign',
  })
  bulkAssign(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkAssignDto,
  ) {
    return this.assignments.bulkAssign(tenantId, user, dto);
  }

  @Post('reassign')
  @RequirePermission(P.INVESTIGATIONS_REASSIGN)
  @ApiOperation({ summary: 'Move a case to a different investigator' })
  reassign(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReassignDto,
  ) {
    return this.assignments.reassign(tenantId, user, dto);
  }

  /**
   * Ranked candidates. Returns a list; assigns nothing. See the note at the
   * top of `auto-assign.engine.ts` for why that separation is deliberate.
   */
  @Get('suggest')
  @RequirePermission(P.INVESTIGATIONS_ASSIGN)
  @ApiOperation({ summary: 'Rank investigators for a case (advisory only)' })
  suggest(@TenantId() tenantId: string, @Query() query: SuggestQueryDto) {
    return this.assignments.suggest(tenantId, query);
  }

  @Get('workload')
  @RequirePermission(P.INVESTIGATIONS_ASSIGN, P.INVESTIGATORS_VIEW)
  @ApiOperation({ summary: 'Open-case load per investigator' })
  workload(@TenantId() tenantId: string) {
    return this.assignments.workloadSummary(tenantId);
  }

  @Get('investigation/:investigationId')
  @RequirePermission(P.INVESTIGATIONS_VIEW)
  @ApiOperation({ summary: 'The full assignment chain for one case' })
  history(
    @TenantId() tenantId: string,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
  ) {
    return this.assignments.historyFor(tenantId, investigationId);
  }

  // ── The field investigator's routes ──────────────────────────────────────

  @Get('my')
  @AllowPrincipals(PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'Your own current assignments (mobile client)' })
  myAssignments(
    @TenantId() tenantId: string,
    @CurrentUser() investigator: AuthenticatedInvestigator,
    @Query('status') status?: AssignmentStatus,
  ) {
    return this.assignments.forInvestigator(
      tenantId,
      investigator.id,
      status ? [status] : undefined,
    );
  }

  @Post(':id/respond')
  @AllowPrincipals(PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'Accept or decline an assignment (mobile client)' })
  respond(
    @TenantId() tenantId: string,
    @CurrentUser() investigator: AuthenticatedInvestigator,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondToAssignmentDto,
  ) {
    return this.assignments.respond(
      tenantId,
      investigator.id,
      investigator.fullName,
      id,
      dto,
    );
  }
}
