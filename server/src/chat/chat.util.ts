import { PrincipalType } from '@prisma/client';
import { extname } from 'node:path';
import { FileSignature } from '../common/utils/file-signature.util';

/** A side of a conversation. */
export interface ChatParty {
  type: PrincipalType;
  id: string;
}

export const MAX_BODY_LENGTH = 4000;
export const MAX_FILES_PER_MESSAGE = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Retention bounds: at least a month, at most ten years. */
export const DEFAULT_RETENTION_DAYS = 365;
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;

/**
 * The key that makes a pair's conversation unique: both sides as
 * "<TYPE>:<id>", sorted, so A→B and B→A are the same thread.
 */
export function pairKey(a: ChatParty, b: ChatParty): string {
  return [`${a.type}:${a.id}`, `${b.type}:${b.id}`].sort().join('|');
}

/**
 * Who may talk to whom. Office staff talk to anyone in their company;
 * an investigator talks to the office, not to other investigators — a field
 * worker's channel is the coordinator, and investigator-to-investigator chat
 * would be the one conversation nobody in the office can see the need for.
 */
export function mayTalk(from: ChatParty, to: ChatParty): boolean {
  if (from.type === to.type && from.id === to.id) return false;
  if (
    from.type === PrincipalType.INVESTIGATOR &&
    to.type === PrincipalType.INVESTIGATOR
  ) {
    return false;
  }
  return true;
}

/**
 * The content type a stored file is served as, decided from its bytes
 * (the signature) and — only to tell apart formats that share a container —
 * its extension. The uploader's own Content-Type is never trusted.
 * Returns null for anything not accepted.
 */
export function attachmentType(
  signature: FileSignature,
  fileName: string,
): string | null {
  const extension = extname(fileName).toLowerCase();
  switch (signature) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    case 'pdf':
      return 'application/pdf';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'webm':
      return 'video/webm';
    case 'mp4':
      return extension === '.m4a' ? 'audio/mp4' : 'video/mp4';
    case 'zip':
      // Office's modern formats are zip containers.
      return (
        {
          '.docx':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xlsx':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.pptx':
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.zip': 'application/zip',
        }[extension] ?? null
      );
    case 'ole':
      return (
        {
          '.doc': 'application/msword',
          '.xls': 'application/vnd.ms-excel',
          '.ppt': 'application/vnd.ms-powerpoint',
        }[extension] ?? null
      );
    default:
      return null;
  }
}

/** The company's chat retention, from its settings JSON, clamped. */
export function retentionDaysFrom(settings: unknown): number {
  const raw = (settings as { chatRetentionDays?: unknown } | null)
    ?.chatRetentionDays;
  const days = typeof raw === 'number' ? Math.round(raw) : NaN;
  if (!Number.isFinite(days)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, days));
}

/** Trim a message; collapse runs of blank lines; null when nothing is left. */
export function cleanBody(body: string | undefined | null): string | null {
  if (!body) return null;
  const text = body
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text : null;
}
