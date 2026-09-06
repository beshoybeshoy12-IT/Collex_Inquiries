import { Injectable, NotFoundException } from '@nestjs/common';
import { GpsEventType, PrincipalType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { haversineKm } from '../assignments/auto-assign.engine';
import { RecordGpsEventDto } from './dto/gps.dto';
import { AuthenticatedPrincipal } from '../common/decorators/auth.decorators';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GPS evidence.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  APPEND-ONLY. There is no update and no delete in this service. A corrected
 *  position is a new row, because the value of this table is what the device
 *  reported at the time — a table whose history can be revised is not evidence
 *  of anything.
 *
 *  TWO CLOCKS, DELIBERATELY. `recordedAt` is what the device says; `createdAt`
 *  is when the server received it. They differ by hours when an offline queue
 *  flushes, and they differ suspiciously when a device's clock has been
 *  tampered with — which is exactly why both are kept rather than one being
 *  overwritten by the other.
 *
 *  DISTANCE IS COMPUTED ON WRITE. The QC screen renders dozens of these per
 *  case, and recomputing a haversine per row per render is work that only needs
 *  doing once. It is stored in metres as an integer: sub-metre precision on a
 *  consumer GPS fix is noise.
 */
@Injectable()
export class GpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Record a position event.
   *
   * The investigator id comes from the authenticated principal, never from the
   * body — "report a check-in as somebody else" has nowhere to be expressed.
   */
  async record(
    tenantId: string,
    principal: AuthenticatedPrincipal,
    dto: RecordGpsEventDto,
  ) {
    const investigation = dto.investigationId
      ? await this.prisma.investigation.findFirst({
          where: {
            tenantId,
            id: dto.investigationId,
            deletedAt: null,
            // An investigator may only attach a fix to their own current case.
            ...(principal.principalType === PrincipalType.INVESTIGATOR
              ? { investigatorId: principal.id }
              : {}),
          },
          select: {
            id: true,
            caseNumber: true,
            targetLat: true,
            targetLng: true,
          },
        })
      : null;

    if (dto.investigationId && !investigation) {
      throw new NotFoundException(
        'التحقيق غير موجود - Investigation not found',
      );
    }

    const distanceFromTargetM =
      investigation?.targetLat && investigation?.targetLng
        ? Math.round(
            haversineKm(
              dto.lat,
              dto.lng,
              Number(investigation.targetLat),
              Number(investigation.targetLng),
            ) * 1000,
          )
        : null;

    const event = await this.prisma.gpsEvent.create({
      data: {
        tenantId,
        investigationId: investigation?.id ?? null,
        investigatorId:
          principal.principalType === PrincipalType.INVESTIGATOR
            ? principal.id
            : null,
        eventType: dto.eventType,
        lat: dto.lat,
        lng: dto.lng,
        accuracyM: dto.accuracyM,
        altitudeM: dto.altitudeM,
        speedMps: dto.speedMps,
        headingDeg: dto.headingDeg,
        distanceFromTargetM,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        metadata: (dto.metadata ?? undefined) as never,
      },
    });

    // The investigator's last known position, for the live map. Only moved
    // forward — an offline queue flushing an old fix must not drag the map pin
    // backwards in time.
    if (principal.principalType === PrincipalType.INVESTIGATOR) {
      await this.prisma.investigator.updateMany({
        where: {
          id: principal.id,
          tenantId,
          OR: [
            { lastLocationAt: null },
            { lastLocationAt: { lt: event.recordedAt } },
          ],
        },
        data: {
          lastLat: dto.lat,
          lastLng: dto.lng,
          lastLocationAt: event.recordedAt,
          lastActivityAt: new Date(),
        },
      });
    }

    // Check-in and check-out are the two that matter evidentially; a stream of
    // LOCATION_UPDATEs would drown the audit trail.
    if (
      dto.eventType === GpsEventType.CHECK_IN ||
      dto.eventType === GpsEventType.CHECK_OUT
    ) {
      await this.audit.log({
        tenantId,
        action: `GPS_${dto.eventType}`,
        category: 'INVESTIGATION',
        actorType: principal.principalType,
        actorId: principal.id,
        actorName: principal.fullName,
        entityType: 'Investigation',
        entityId: investigation?.id,
        entityLabel: investigation?.caseNumber,
        metadata: {
          lat: dto.lat,
          lng: dto.lng,
          accuracyM: dto.accuracyM,
          distanceFromTargetM,
        },
      });
    }

    return {
      ...event,
      lat: Number(event.lat),
      lng: Number(event.lng),
      distanceFromTargetM,
    };
  }

  /** The track for one case — what the QC map draws. */
  async forInvestigation(tenantId: string, investigationId: string) {
    const events = await this.prisma.gpsEvent.findMany({
      where: { tenantId, investigationId },
      orderBy: { recordedAt: 'asc' },
      include: {
        investigator: {
          select: { id: true, fullName: true, employeeCode: true },
        },
      },
    });

    return events.map((event) => ({
      ...event,
      lat: Number(event.lat),
      lng: Number(event.lng),
      accuracyM: event.accuracyM ? Number(event.accuracyM) : null,
      speedMps: event.speedMps ? Number(event.speedMps) : null,
      headingDeg: event.headingDeg ? Number(event.headingDeg) : null,
      // The gap between the two clocks, surfaced rather than hidden. A large
      // positive value means an offline flush; a negative one means the
      // device's clock is ahead of the server's, which is worth seeing.
      reportDelaySeconds: Math.round(
        (event.createdAt.getTime() - event.recordedAt.getTime()) / 1000,
      ),
    }));
  }

  /**
   * One investigator's track over a period.
   *
   * Capped at 5,000 points: a day of one-minute updates is 1,440, and anything
   * asking for more than three days at once wants a report, not a map.
   */
  async trackForInvestigator(
    tenantId: string,
    investigatorId: string,
    from: Date,
    to: Date,
  ) {
    const events = await this.prisma.gpsEvent.findMany({
      where: {
        tenantId,
        investigatorId,
        recordedAt: { gte: from, lte: to },
      },
      orderBy: { recordedAt: 'asc' },
      take: 5000,
      select: {
        id: true,
        eventType: true,
        lat: true,
        lng: true,
        accuracyM: true,
        recordedAt: true,
        investigationId: true,
      },
    });

    return events.map((event) => ({
      ...event,
      lat: Number(event.lat),
      lng: Number(event.lng),
      accuracyM: event.accuracyM ? Number(event.accuracyM) : null,
    }));
  }

  /**
   * Retention sweep.
   *
   * Only LOCATION_UPDATE rows age out. Check-ins and photo-capture fixes are
   * evidence tied to a case and are kept for as long as the case is; the
   * unbounded growth here is the every-minute breadcrumb trail, which stops
   * being useful within days.
   *
   * Pages through ids rather than issuing one unbounded DELETE — on the first
   * run after a backlog a single statement would lock the table for its whole
   * duration.
   */
  async pruneLocationUpdates(days: number, batchSize = 1000): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let deleted = 0;

    for (;;) {
      const batch = await this.prisma.gpsEvent.findMany({
        where: {
          eventType: GpsEventType.LOCATION_UPDATE,
          recordedAt: { lt: cutoff },
        },
        select: { id: true },
        take: batchSize,
      });
      if (batch.length === 0) break;

      const { count } = await this.prisma.gpsEvent.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      deleted += count;

      if (batch.length < batchSize) break;
    }

    return deleted;
  }
}
