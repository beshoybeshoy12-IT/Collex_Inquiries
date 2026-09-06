import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrincipalType } from '@prisma/client';
import { InvestigationsService } from './investigations.service';
import {
  AddCommentDto,
  BulkArchiveDto,
  CreateInvestigationDto,
  InvestigationQueryDto,
  TransitionInvestigationDto,
  UpdateInvestigationDto,
} from './dto/investigation.dto';
import {
  AllowPrincipals,
  CurrentUser,
  RequirePermission,
  TenantId,
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from '../common/decorators/auth.decorators';
import { P } from '../common/constants/permissions';

/**
 * `/api/v1/investigations`
 *
 * Thin by design: every route resolves its arguments and hands off. The
 * business rules — visibility, the status machine, SLA resolution — live in the
 * service, where the import pipeline and the future mobile endpoints reach the
 * same code rather than a second copy of it.
 *
 * Note which routes admit an investigator. Reading a case and driving its
 * status are shared with the field, because those are exactly the operations
 * the mobile application performs; the service then narrows what an
 * investigator can see to their own assignments, and the state machine narrows
 * what they can do to the field transitions.
 */
@ApiTags('investigations')
@ApiBearerAuth()
@Controller({ path: 'investigations', version: '1' })
export class InvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get()
  @RequirePermission(P.INVESTIGATIONS_VIEW)
  @ApiOperation({ summary: 'Search and filter cases' })
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: InvestigationQueryDto,
  ) {
    return this.investigations.findAll(tenantId, user, query);
  }

  /** Sidebar counters. Separate from the list so a badge is not a full page. */
  @Get('counts')
  @RequirePermission(P.INVESTIGATIONS_VIEW)
  @ApiOperation({ summary: 'Case counts by status, for the sidebar' })
  counts(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.investigations.counts(tenantId, user);
  }

  @Get(':id')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @RequirePermission(P.INVESTIGATIONS_VIEW)
  @ApiOperation({ summary: 'One case, with everything the case screen needs' })
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.investigations.findOne(tenantId, id, principal);
  }

  @Get(':id/timeline')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @RequirePermission(P.INVESTIGATIONS_VIEW)
  @ApiOperation({
    summary: 'Status history, comments and assignments, in order',
  })
  timeline(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.investigations.timeline(tenantId, id, principal);
  }

  @Post()
  @RequirePermission(P.INVESTIGATIONS_CREATE)
  @ApiOperation({ summary: 'Create a case by hand' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvestigationDto,
  ) {
    return this.investigations.create(tenantId, user, dto);
  }

  @Patch(':id')
  @RequirePermission(P.INVESTIGATIONS_EDIT)
  @ApiOperation({ summary: 'Edit a case that has not been assigned yet' })
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvestigationDto,
  ) {
    return this.investigations.update(tenantId, id, user, dto);
  }

  /**
   * The only route that changes `status`.
   *
   * Shared with the mobile client: accept, travel, arrive, submit are all this
   * endpoint. The state machine decides whether the caller's principal type may
   * make the move, so one route needs no per-actor duplicate.
   */
  @Post(':id/transition')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'Move a case to another status' })
  transition(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionInvestigationDto,
  ) {
    return this.investigations.transition(tenantId, id, principal, dto);
  }

  @Post(':id/comments')
  @AllowPrincipals(PrincipalType.WEB_USER, PrincipalType.INVESTIGATOR)
  @ApiOperation({ summary: 'Add a note to a case' })
  addComment(
    @TenantId() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.investigations.addComment(tenantId, id, principal, dto);
  }

  @Post('archive')
  @RequirePermission(P.INVESTIGATIONS_ARCHIVE)
  @ApiOperation({ summary: 'Archive many completed or cancelled cases' })
  archiveMany(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkArchiveDto,
  ) {
    return this.investigations.archiveMany(
      tenantId,
      user,
      dto.investigationIds,
    );
  }

  @Delete(':id')
  @RequirePermission(P.INVESTIGATIONS_DELETE)
  @ApiOperation({ summary: 'Soft-delete a case that has not started' })
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.investigations.remove(tenantId, id, user);
  }
}
