import { BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

/**
 * The Excel export's period check. A broken pattern once rejected every
 * period, so a real one is pinned here.
 */
function setup() {
  const prisma = {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ timezone: 'Africa/Cairo', settings: {} }),
    },
    attendanceSession: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new AttendanceService(
    prisma as never,
    { log: jest.fn() } as never,
    { emitToTenant: jest.fn() } as never,
  );
  return { service, prisma };
}

describe('AttendanceService.exportRange', () => {
  it('accepts an ordinary month and returns a workbook', async () => {
    const { service } = setup();
    const result = await service.exportRange(
      't1',
      '2026-11-01',
      '2026-11-24',
      'ar',
    );
    expect(result.filename).toBe('attendance-2026-11-01_2026-11-24.xlsx');
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('refuses a malformed date, a reversed period and more than 92 days', async () => {
    const { service } = setup();
    await expect(
      service.exportRange('t1', '24/11/2026', '2026-11-24', 'ar'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.exportRange('t1', '2026-11-24', '2026-11-01', 'ar'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.exportRange('t1', '2026-01-01', '2026-11-24', 'ar'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
