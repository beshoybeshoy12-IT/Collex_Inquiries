import api from '../services/api';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Download a file the API generates (an Excel template, an error report, an
 * export) and save it under `fileName`.
 *
 * A plain `<a href="/api/...">` cannot do this: the access token lives in
 * memory, not in a cookie, so that request arrives unauthenticated. The file
 * is fetched through the signed-in axios instance instead.
 *
 * These endpoints answer with opaque bytes and no file name, so a desktop
 * download manager does not grab the request and hand the page an empty
 * reply; the typed Blob and its name are put back together here.
 *
 * @param {string} path  API path, e.g. '/imports/template'
 * @param {{ fileName: string, params?: object, mimeType?: string }} options
 */
export async function saveFromApi(path, { fileName, params, mimeType = XLSX }) {
  const response = await api.get(path, { params, responseType: 'blob', timeout: 120_000 });
  const blob = new Blob([response.data], { type: mimeType });
  if (blob.size === 0) {
    const error = new Error('EMPTY_DOWNLOAD');
    error.emptyDownload = true;
    throw error;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The message to show for a failed `saveFromApi` (blob error bodies are JSON). */
export async function saveErrorMessage(error, t) {
  if (error?.emptyDownload) return t('media.emptyDownload');
  try {
    const body = JSON.parse(await error.response?.data?.text?.());
    if (body?.message) return Array.isArray(body.message) ? body.message.join('\n') : body.message;
  } catch {
    // not a JSON body
  }
  return error?.friendlyMessage;
}
