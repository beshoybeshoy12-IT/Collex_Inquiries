import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrincipalType } from '@prisma/client';
import { ProfileService } from './profile.service';

/**
 * Profile images: the rules worth pinning are the security ones. Only real
 * raster images by their bytes (an SVG renamed .png is refused), only the
 * caller's own row, and a replaced file does not linger in the bucket.
 */
describe('ProfileService', () => {
  const user = {
    id: 'u1',
    tenantId: 't1',
    email: 'someone@example.test',
    fullName: 'Someone',
    principalType: PrincipalType.WEB_USER,
  } as never;

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

  const file = (buffer: Buffer) =>
    ({ buffer, size: buffer.length, originalname: 'x.png' }) as Express.Multer.File;

  let prisma: { user: { findFirst: jest.Mock; update: jest.Mock } };
  let storage: { putObject: jest.Mock; deleteObject: jest.Mock; getObject: jest.Mock };
  let service: ProfileService;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ avatarKey: null, coverKey: null }),
        update: jest.fn(),
      },
    };
    storage = {
      putObject: jest.fn().mockResolvedValue({ key: 't/t1/profile/2026/11/new.png' }),
      deleteObject: jest.fn(),
      getObject: jest.fn(),
    };
    service = new ProfileService(prisma as never, storage as never, { log: jest.fn() } as never);
  });

  it('stores a PNG under the tenant and points the caller’s row at it', async () => {
    await service.upload(user, 'avatar', file(PNG));

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', prefix: 'profile', contentType: 'image/png' }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatarKey: 't/t1/profile/2026/11/new.png' },
    });
  });

  it('refuses an SVG whatever it is called', async () => {
    await expect(service.upload(user, 'avatar', file(SVG))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('refuses an avatar over 5 MB', async () => {
    const big = { ...file(PNG), size: 6 * 1024 * 1024 } as Express.Multer.File;
    await expect(service.upload(user, 'avatar', big)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deletes the file it replaced', async () => {
    prisma.user.findFirst.mockResolvedValue({ avatarKey: null, coverKey: 't/t1/profile/old.png' });
    await service.upload(user, 'cover', file(PNG));
    expect(storage.deleteObject).toHaveBeenCalledWith('t1', 't/t1/profile/old.png');
  });

  it('serves the type the bytes are, not a stored one', async () => {
    prisma.user.findFirst.mockResolvedValue({ avatarKey: 't/t1/profile/a.png', coverKey: null });
    storage.getObject.mockResolvedValue(PNG);
    await expect(service.read(user, 'avatar')).resolves.toMatchObject({
      contentType: 'image/png',
    });

    storage.getObject.mockResolvedValue(SVG);
    await expect(service.read(user, 'avatar')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports versions without exposing the key path', async () => {
    prisma.user.findFirst.mockResolvedValue({ avatarKey: 't/t1/profile/2026/11/abc.png', coverKey: null });
    await expect(service.summary(user)).resolves.toEqual({ avatar: 'abc.png', cover: null });
  });
});
