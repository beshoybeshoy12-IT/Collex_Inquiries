import { InvestigatorsService } from './investigators.service';

/**
 * Live tracking from the handset. Every rule here is about what must NOT be
 * stored or shown: points off shift, a fix on a colleague's case, a late flush
 * dragging the map pin back, coordinates on the socket.
 */
function setup(availability = 'AVAILABLE') {
  const prisma = {
    investigator: {
      findFirst: jest.fn().mockResolvedValue({ availability }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    investigation: {
      findMany: jest.fn().mockResolvedValue([{ id: 'own-case' }]),
    },
    gpsEvent: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const realtime = { emitToTenant: jest.fn() };
  const service = new InvestigatorsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    realtime as never,
  );
  return { service, prisma, realtime };
}

describe('InvestigatorsService.reportLocations', () => {
  it('stores nothing while the investigator is off shift', async () => {
    const { service, prisma, realtime } = setup('OFFLINE');

    const result = await service.reportLocations('t1', 'inv1', [
      { lat: 30, lng: 31 },
    ]);

    expect(result).toEqual({ recorded: 0, dropped: 1, reason: 'OFF_SHIFT' });
    expect(prisma.gpsEvent.createMany).not.toHaveBeenCalled();
    expect(prisma.investigator.updateMany).not.toHaveBeenCalled();
    expect(realtime.emitToTenant).not.toHaveBeenCalled();
  });

  it('drops a case id that is not one of the investigator’s own cases', async () => {
    const { service, prisma } = setup();

    await service.reportLocations('t1', 'inv1', [
      { lat: 30, lng: 31, investigationId: 'own-case' },
      { lat: 30, lng: 31, investigationId: 'colleagues-case' },
    ]);

    const rows = prisma.gpsEvent.createMany.mock.calls[0][0].data;
    expect(
      rows.map((r: { investigationId: string | null }) => r.investigationId),
    ).toEqual(['own-case', null]);
    expect(prisma.investigation.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: 't1',
      investigatorId: 'inv1',
    });
  });

  it('moves the map pin to the newest point, forward only', async () => {
    const { service, prisma } = setup();

    await service.reportLocations('t1', 'inv1', [
      { lat: 30.1, lng: 31.1, recordedAt: '2026-11-20T08:00:00.000Z' },
      { lat: 30.3, lng: 31.3, recordedAt: '2026-11-20T08:02:00.000Z' },
      { lat: 30.2, lng: 31.2, recordedAt: '2026-11-20T08:01:00.000Z' },
    ]);

    const call = prisma.investigator.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ lastLat: 30.3, lastLng: 31.3 });
    // Guarded on the stored time, so an older flush cannot overwrite a newer pin.
    expect(call.where.OR).toEqual([
      { lastLocationAt: null },
      { lastLocationAt: { lt: new Date('2026-11-20T08:02:00.000Z') } },
    ]);
  });

  it('never dates the pin in the future when the phone clock runs ahead', async () => {
    const { service, prisma } = setup();
    const future = new Date(Date.now() + 3 * 3_600_000).toISOString();

    await service.reportLocations('t1', 'inv1', [
      { lat: 30, lng: 31, recordedAt: future },
    ]);

    const at = prisma.investigator.updateMany.mock.calls[0][0].data
      .lastLocationAt as Date;
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('signals the map with the investigator id only — no coordinates on the socket', async () => {
    const { service, realtime } = setup();

    await service.reportLocations('t1', 'inv1', [{ lat: 30, lng: 31 }]);

    expect(realtime.emitToTenant).toHaveBeenCalledWith(
      't1',
      'investigator:location',
      {
        investigatorId: 'inv1',
      },
    );
  });
});
