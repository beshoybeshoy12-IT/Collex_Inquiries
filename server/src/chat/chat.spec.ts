import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrincipalType } from '@prisma/client';
import { ChatService } from './chat.service';
import {
  attachmentType,
  cleanBody,
  mayTalk,
  pairKey,
  retentionDaysFrom,
} from './chat.util';

const WEB = PrincipalType.WEB_USER;
const INV = PrincipalType.INVESTIGATOR;

describe('chat rules', () => {
  it('gives a pair one conversation key whichever side starts', () => {
    const a = { type: WEB, id: 'u1' };
    const b = { type: INV, id: 'i1' };
    expect(pairKey(a, b)).toBe(pairKey(b, a));
  });

  it('lets the office talk to anyone, investigators only to the office', () => {
    expect(mayTalk({ type: WEB, id: 'u1' }, { type: WEB, id: 'u2' })).toBe(
      true,
    );
    expect(mayTalk({ type: WEB, id: 'u1' }, { type: INV, id: 'i1' })).toBe(
      true,
    );
    expect(mayTalk({ type: INV, id: 'i1' }, { type: WEB, id: 'u1' })).toBe(
      true,
    );
    expect(mayTalk({ type: INV, id: 'i1' }, { type: INV, id: 'i2' })).toBe(
      false,
    );
    expect(mayTalk({ type: WEB, id: 'u1' }, { type: WEB, id: 'u1' })).toBe(
      false,
    );
  });

  it('decides a file type from its bytes, using the name only inside a container', () => {
    expect(attachmentType('pdf', 'anything.exe')).toBe('application/pdf');
    expect(attachmentType('zip', 'report.docx')).toContain('wordprocessingml');
    expect(attachmentType('zip', 'payload.jar')).toBeNull();
    expect(attachmentType('unknown', 'script.html')).toBeNull();
  });

  it('clamps retention to a month .. ten years, defaulting to a year', () => {
    expect(retentionDaysFrom({})).toBe(365);
    expect(retentionDaysFrom({ chatRetentionDays: 5 })).toBe(30);
    expect(retentionDaysFrom({ chatRetentionDays: 99999 })).toBe(3650);
    expect(retentionDaysFrom({ chatRetentionDays: 90 })).toBe(90);
  });

  it('trims a message and treats whitespace as empty', () => {
    expect(cleanBody('  hi \r\n\n\n\nthere ')).toBe('hi\n\nthere');
    expect(cleanBody('   \n ')).toBeNull();
  });
});

describe('ChatService access', () => {
  const me = {
    id: 'u1',
    tenantId: 't1',
    fullName: 'Me',
    principalType: WEB,
  } as never;

  const build = (prisma: Record<string, unknown>) =>
    new ChatService(
      prisma as never,
      {
        putObject: jest.fn(),
        getObject: jest.fn(),
        deleteObject: jest.fn(),
      } as never,
      { log: jest.fn() } as never,
      { emitToPrincipal: jest.fn() } as never,
    );

  it('answers 404 for a conversation the caller is not in', async () => {
    const service = build({
      chatConversation: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.messages(me, 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses an empty message', async () => {
    const service = build({
      chatConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c1', participants: [] }),
      },
    });
    await expect(service.send(me, 'c1', '   ', [])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a file whose bytes are not an allowed type, storing nothing', async () => {
    const putObject = jest.fn();
    const service = new ChatService(
      {
        chatConversation: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'c1', participants: [] }),
        },
      } as never,
      { putObject } as never,
      { log: jest.fn() } as never,
      { emitToPrincipal: jest.fn() } as never,
    );
    const file = {
      originalname: 'invoice.pdf',
      size: 20,
      buffer: Buffer.from('<html><script>alert(1)</script>'),
    } as Express.Multer.File;
    await expect(service.send(me, 'c1', 'see', [file])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(putObject).not.toHaveBeenCalled();
  });

  it('will not delete somebody else’s message', async () => {
    const service = build({
      chatMessage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm1',
          senderType: WEB,
          senderId: 'u2',
          attachments: [],
          conversation: { participants: [] },
        }),
      },
    });
    await expect(service.deleteMessage(me, 'm1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serves a file only to a participant', async () => {
    const service = build({
      chatAttachment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'a1',
          storageKey: 'k',
          message: {
            conversationId: 'c1',
            conversation: {
              participants: [
                { principalType: WEB, principalId: 'u2' },
                { principalType: INV, principalId: 'i1' },
              ],
            },
          },
        }),
      },
    });
    await expect(service.attachment(me, 'a1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('will not open a conversation between two investigators', async () => {
    const service = build({});
    const investigator = {
      ...(me as object),
      id: 'i1',
      principalType: INV,
    } as never;
    await expect(
      service.open(investigator, { type: INV, id: 'i2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
