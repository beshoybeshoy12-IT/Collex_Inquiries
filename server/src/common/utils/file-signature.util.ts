/**
 * Magic-byte sniffing.
 *
 * The only reliable statement about what an uploaded file is comes from its
 * first few bytes. The `Content-Type` header and the filename extension are
 * both supplied by whoever is uploading, and an attacker uploading a script as
 * `photo.jpg` with `image/jpeg` gets past anything that trusts either.
 *
 * The list is deliberately short: every format the system actually accepts, and
 * nothing else. In particular SVG is NOT here and is not accepted anywhere — an
 * SVG is a document that can carry script, and one served from the same origin
 * as the application is stored cross-site scripting.
 */

export type FileSignature =
  | 'zip' // xlsx, xlsm, docx — and anything else in a ZIP container
  | 'ole' // legacy xls / doc
  | 'pdf'
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'heic'
  | 'mp4'
  | 'webm'
  | 'mp3'
  | 'wav'
  | 'ogg'
  | 'unknown';

interface SignatureRule {
  signature: FileSignature;
  /** Byte offset the pattern starts at. */
  offset: number;
  bytes: number[];
  /** Optional secondary check further into the file. */
  also?: { offset: number; ascii: string };
}

const RULES: SignatureRule[] = [
  { signature: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { signature: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] },
  { signature: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x07, 0x08] },
  {
    signature: 'ole',
    offset: 0,
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
  { signature: 'pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { signature: 'jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  {
    signature: 'png',
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { signature: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  {
    // RIFF....WEBP — the container is RIFF, so the format tag has to be read.
    signature: 'webp',
    offset: 0,
    bytes: [0x52, 0x49, 0x46, 0x46],
    also: { offset: 8, ascii: 'WEBP' },
  },
  {
    signature: 'wav',
    offset: 0,
    bytes: [0x52, 0x49, 0x46, 0x46],
    also: { offset: 8, ascii: 'WAVE' },
  },
  {
    // ....ftypheic / heix / mif1 — ISO-BMFF, same family as MP4.
    signature: 'heic',
    offset: 4,
    bytes: [0x66, 0x74, 0x79, 0x70],
    also: { offset: 8, ascii: 'heic' },
  },
  { signature: 'mp4', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  { signature: 'webm', offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { signature: 'mp3', offset: 0, bytes: [0x49, 0x44, 0x33] }, // ID3
  { signature: 'mp3', offset: 0, bytes: [0xff, 0xfb] },
  { signature: 'ogg', offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] }, // OggS
];

function matches(buffer: Buffer, rule: SignatureRule): boolean {
  if (buffer.length < rule.offset + rule.bytes.length) return false;

  for (let i = 0; i < rule.bytes.length; i++) {
    if (buffer[rule.offset + i] !== rule.bytes[i]) return false;
  }

  if (rule.also) {
    const end = rule.also.offset + rule.also.ascii.length;
    if (buffer.length < end) return false;
    if (buffer.toString('ascii', rule.also.offset, end) !== rule.also.ascii) {
      return false;
    }
  }

  return true;
}

/** What this buffer actually is, from its leading bytes. */
export function sniffSignature(buffer: Buffer | undefined): FileSignature {
  if (!buffer || buffer.length < 4) return 'unknown';

  // Ordered so the `also`-qualified rules are tried before their bare prefix
  // — otherwise every RIFF file would be reported as the first RIFF rule.
  const ordered = [...RULES].sort(
    (a, b) => (b.also ? 1 : 0) - (a.also ? 1 : 0),
  );

  for (const rule of ordered) {
    if (matches(buffer, rule)) return rule.signature;
  }

  return 'unknown';
}

/** Signatures acceptable for a given media type. */
export const SIGNATURES_BY_MEDIA_TYPE: Record<string, FileSignature[]> = {
  PHOTO: ['jpeg', 'png', 'webp', 'heic'],
  SIGNATURE: ['jpeg', 'png', 'webp'],
  DOCUMENT: ['pdf', 'jpeg', 'png', 'zip', 'ole'],
  AUDIO: ['mp3', 'wav', 'ogg', 'mp4'],
  VIDEO: ['mp4', 'webm'],
};

/** Whether a buffer is acceptable as the given media type. */
export function isAcceptableFor(
  mediaType: string,
  buffer: Buffer | undefined,
): { ok: boolean; detected: FileSignature } {
  const detected = sniffSignature(buffer);
  const allowed = SIGNATURES_BY_MEDIA_TYPE[mediaType] ?? [];
  return { ok: allowed.includes(detected), detected };
}

/**
 * Extensions we will ever hand back to a browser, mapped to content types.
 *
 * Used when serving a download through the API. An extension not in this map
 * is served as `application/octet-stream`, which downloads rather than renders
 * — the safe default for anything unrecognised.
 */
export const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
};
