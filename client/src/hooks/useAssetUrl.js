import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

/**
 * Fetch one asset. With S3/R2 the server answers with a short-lived signed
 * URL; with the local storage driver it streams the bytes itself. Asking for
 * a blob covers both: a JSON reply is read for its URL, anything else IS the
 * file.
 *
 * `inline` is for showing the file in the page. The server then sends opaque
 * bytes with no file name — so the browser will not render them on our origin
 * and a download manager will not grab them — and the typed Blob is rebuilt
 * here from the MIME type the asset list already gave us.
 *
 * @param {string} assetId
 * @param {{ inline?: boolean, mimeType?: string }} [options]
 */
export async function fetchAsset(assetId, { inline = false, mimeType } = {}) {
  const response = await api.get(`/media/${assetId}/download`, {
    params: inline ? { inline: 1 } : {},
    responseType: 'blob',
    timeout: 120_000,
  });
  const blob = response.data;

  if (blob?.type?.includes('application/json')) {
    const body = JSON.parse(await blob.text());
    const url = body?.data?.url ?? body?.url;
    if (!url) throw new Error('No download URL');
    return { url };
  }

  const disposition = response.headers?.['content-disposition'] ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fileName = encoded ? decodeURIComponent(encoded) : plain;

  const typed = inline && mimeType ? new Blob([blob], { type: mimeType }) : blob;
  return { blob: typed, fileName };
}

/** A URL an <img> or <iframe> can show: the signed one, or an object URL. */
export function useAssetUrl(assetId, mimeType) {
  const query = useQuery({
    queryKey: ['media-url', assetId, 'inline', mimeType ?? ''],
    queryFn: () => fetchAsset(assetId, { inline: true, mimeType }),
    // Signed URLs expire; refetch well before they do rather than showing a
    // broken image.
    staleTime: 10 * 60_000,
    retry: false,
    enabled: Boolean(assetId),
  });

  const blob = query.data?.blob;
  const [objectUrl, setObjectUrl] = useState(null);
  useEffect(() => {
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return { ...query, url: query.data?.url ?? objectUrl };
}
