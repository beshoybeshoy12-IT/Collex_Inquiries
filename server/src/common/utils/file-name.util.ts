/**
 * File names: Arabic in, Arabic out.
 *
 * MULTIPART NAMES ARRIVE AS LATIN-1. Busboy (under multer) decodes the
 * `filename` of a multipart part as Latin-1 by default, so the UTF-8 bytes of
 * "عقد.pdf" come out as "Ø¹Ù‚Ø¯.pdf". `decodeUploadName` reverses that when —
 * and only when — the reversal is valid UTF-8: a genuine Latin-1 name such as
 * "café.pdf" does not survive the round trip and is left alone, and plain
 * ASCII is unchanged either way.
 *
 * HEADERS CANNOT CARRY ARABIC. Node refuses a header containing characters
 * outside Latin-1, so a download of "عقد.pdf" with a naive
 * `filename="عقد.pdf"` throws. `contentDisposition` sends an ASCII fallback in
 * `filename` and the real name in RFC 5987 `filename*`, which every current
 * browser prefers.
 */

export function decodeUploadName(name: string): string {
  if (!name) return name;
  // Only a string made entirely of single-byte code points can be mis-decoded
  // UTF-8; anything else is already a proper Unicode string.
  // eslint-disable-next-line no-control-regex
  if (!/^[\u0000-ÿ]*$/.test(name)) return name;

  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/** Strips what a file name must never carry: paths, quotes, control chars. */
export function safeFileName(name: string): string {
  const cleaned = decodeUploadName(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/]/g, '')
    .trim();
  return cleaned.slice(0, 255) || 'file';
}

export function contentDisposition(
  name: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  const real = safeFileName(name);
  const ascii = real.replace(/[^\x20-\x7e]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(real)}`;
}

/**
 * Types the web viewer may show in place (in an <img>, <iframe> or player)
 * rather than only download. Never HTML, SVG or anything scriptable.
 */
export function isViewable(mimeType: string | null | undefined): boolean {
  const mime = mimeType ?? '';
  return (
    mime === 'application/pdf' ||
    ['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
    mime.startsWith('audio/') ||
    mime.startsWith('video/')
  );
}
