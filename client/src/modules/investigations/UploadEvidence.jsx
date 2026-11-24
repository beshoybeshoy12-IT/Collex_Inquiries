import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

/** What each kind of evidence accepts — mirrors ALLOWED_CONTENT_TYPES on the server. */
const ACCEPT = {
  PHOTO: 'image/jpeg,image/png,image/webp,image/heic',
  DOCUMENT:
    'application/pdf,image/jpeg,image/png,' +
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Some browsers report no type for .heic or Office files; the extension fills in.
const BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function contentTypeOf(file) {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  return BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * One file, the same two ways the field app uploads: straight to the bucket
 * with a presigned URL when storage supports it, otherwise through the API.
 * Either way the server checks the bytes, not the name.
 */
async function uploadOne(file, meta) {
  try {
    const { data: ticket } = await api.post('/media/request-upload', meta);
    // Plain fetch, not the API client: the bucket must not receive our token.
    const put = await fetch(ticket.uploadUrl, {
      method: ticket.method || 'PUT',
      headers: ticket.headers,
      body: file,
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    return (await api.post(`/media/${ticket.assetId}/confirm`, {})).data;
  } catch (error) {
    if (error.errorCode !== 'PRESIGN_UNSUPPORTED') throw error;
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== '') form.append(key, String(value));
  }
  form.append('file', file);
  // Photos from a phone can be large; the default 30 s is for JSON.
  return (await api.post('/media/upload', form, { timeout: 120_000 })).data;
}

/**
 * "Add photos" / "Add documents" on a case. Several files at once, with an
 * optional category and caption applied to all of them, and a line per file
 * showing how it went — one bad file does not stop the rest.
 */
export default function UploadEvidence({ investigationId, mediaType }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [categoryCode, setCategoryCode] = useState('');
  const [caption, setCaption] = useState('');
  const [results, setResults] = useState({}); // index → 'busy' | 'done' | message
  const [busy, setBusy] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ['media-categories'],
    queryFn: async () => (await api.get('/media/categories/all')).data,
    enabled: open,
  });
  const options = (Array.isArray(categories) ? categories : []).filter(
    (category) => category.isActive !== false && category.mediaType === mediaType,
  );

  const reset = () => {
    setFiles([]);
    setResults({});
    setCategoryCode('');
    setCaption('');
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    reset();
  };

  const start = async () => {
    setBusy(true);
    let succeeded = 0;

    for (const [index, file] of files.entries()) {
      if (results[index] === 'done') continue;
      setResults((current) => ({ ...current, [index]: 'busy' }));
      try {
        await uploadOne(file, {
          mediaType,
          fileName: file.name,
          contentType: contentTypeOf(file),
          sizeBytes: file.size,
          investigationId,
          categoryCode: categoryCode || undefined,
          caption: caption.trim() || undefined,
        });
        succeeded += 1;
        setResults((current) => ({ ...current, [index]: 'done' }));
      } catch (error) {
        setResults((current) => ({
          ...current,
          [index]: localiseServerMessage(error.friendlyMessage ?? error.message),
        }));
      }
    }

    setBusy(false);
    queryClient.invalidateQueries({ queryKey: ['media', investigationId] });

    if (succeeded === files.length) {
      toast.success(t('media.uploaded', { count: succeeded }));
      setOpen(false);
      reset();
    }
  };

  const label = t(mediaType === 'PHOTO' ? 'media.addPhotos' : 'media.addDocuments');

  return (
    <>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
        <i
          className={`bi ${mediaType === 'PHOTO' ? 'bi-camera' : 'bi-file-earmark-plus'} me-1`}
          aria-hidden="true"
        />
        {label}
      </button>

      <Modal
        open={open}
        onClose={close}
        busy={busy}
        title={label}
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={close}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={files.length === 0 || busy}
              onClick={start}
            >
              {busy && (
                <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
              )}
              {t('media.upload')}
            </button>
          </>
        }
      >
        <button
          type="button"
          className="upload-drop w-100 mb-3"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setFiles([...event.dataTransfer.files]);
            setResults({});
          }}
          disabled={busy}
        >
          <i className="bi bi-cloud-arrow-up fs-2 d-block mb-1" aria-hidden="true" />
          <span className="d-block fw-semibold">{t('media.chooseFiles')}</span>
          <span className="d-block small text-body-secondary">
            {t(mediaType === 'PHOTO' ? 'media.photoTypes' : 'media.documentTypes')}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          className="d-none"
          multiple
          accept={ACCEPT[mediaType]}
          onChange={(event) => {
            setFiles([...event.target.files]);
            setResults({});
            event.target.value = '';
          }}
        />

        {files.length > 0 && (
          <ul className="list-group list-group-flush mb-3 small">
            {files.map((file, index) => {
              const result = results[index];
              return (
                <li
                  key={`${file.name}-${index}`}
                  className="list-group-item d-flex align-items-center justify-content-between gap-2 px-0"
                >
                  <span className="min-vw-0">
                    <span className="d-block text-truncate">{file.name}</span>
                    {result && result !== 'busy' && result !== 'done' && (
                      <span className="d-block text-danger">{result}</span>
                    )}
                  </span>
                  <span className="text-nowrap">
                    {result === 'busy' ? (
                      <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                    ) : result === 'done' ? (
                      <i
                        className="bi bi-check-circle-fill text-success"
                        aria-label={t('media.uploadedOne')}
                      />
                    ) : result ? (
                      <i className="bi bi-x-circle-fill text-danger" aria-hidden="true" />
                    ) : (
                      <span className="text-body-tertiary">
                        {Math.max(1, Math.round(file.size / 1024))} KB
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {options.length > 0 && (
          <div className="mb-3">
            <label className="form-label" htmlFor="upload-category">
              {t('media.category')}
            </label>
            <select
              id="upload-category"
              className="form-select"
              value={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
              disabled={busy}
            >
              <option value="">{t('media.noCategory')}</option>
              {options.map((category) => (
                <option key={category.id} value={category.code}>
                  {localisedName(category, i18n.language)}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="form-label" htmlFor="upload-caption">
          {t('media.caption')}
        </label>
        <input
          id="upload-caption"
          className="form-control"
          maxLength={500}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          disabled={busy}
        />
      </Modal>
    </>
  );
}
