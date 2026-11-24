import { NotFoundException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { P } from '../common/constants/permissions';

/**
 * Who sees which announcement is decided in the service. These pin the two
 * ways it could leak: a reader seeing one aimed at another role, and "mark
 * read" confirming that a hidden one exists.
 */
function setup() {
  const prisma = {
    announcement: { findMany: jest.fn().mockResolvedValue([]) },
    announcementRead: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { groupBy: jest.fn().mockResolvedValue([]) },
    role: { count: jest.fn() },
  };
  const service = new AnnouncementsService(
    prisma as never,
    { log: jest.fn() } as never,
    { emitToTenant: jest.fn() } as never,
  );
  return { service, prisma };
}

const reader = {
  id: 'u1',
  tenantId: 't1',
  roleId: 'role-coordinator',
  permissions: [] as string[],
  isSuperAdmin: false,
} as never;

const manager = {
  id: 'u2',
  tenantId: 't1',
  roleId: 'role-admin',
  permissions: [P.ANNOUNCEMENTS_MANAGE],
  isSuperAdmin: false,
} as never;

describe('AnnouncementsService visibility', () => {
  it('limits a reader to everyone-announcements and their own role', async () => {
    const { service, prisma } = setup();

    await service.feed('t1', reader);

    const where = prisma.announcement.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      {
        OR: [
          { audienceRoleIds: { isEmpty: true } },
          { audienceRoleIds: { has: 'role-coordinator' } },
        ],
      },
    ]);
    // And never anything expired.
    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ]);
  });

  it('lets a manager see every audience, with read counts', async () => {
    const { service, prisma } = setup();
    prisma.announcement.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 't',
        body: 'b',
        priority: 'NORMAL',
        pinned: false,
        audienceRoleIds: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        reads: [],
        _count: { reads: 3 },
      },
    ]);
    prisma.user.groupBy.mockResolvedValue([
      { roleId: 'r1', _count: { _all: 4 } },
      { roleId: 'r2', _count: { _all: 6 } },
    ]);

    const result = await service.feed('t1', manager);

    expect(
      prisma.announcement.findMany.mock.calls[0][0].where.AND,
    ).toBeUndefined();
    expect(result.canManage).toBe(true);
    expect(result.items[0]).toMatchObject({ readCount: 3, audienceCount: 10 });
  });

  it('refuses to mark read an announcement the reader cannot see', async () => {
    const { service, prisma } = setup();

    await expect(
      service.markRead('t1', reader, 'hidden'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.announcementRead.createMany).not.toHaveBeenCalled();
  });
});
