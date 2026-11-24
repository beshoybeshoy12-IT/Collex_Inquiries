import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import UploadEvidence from './UploadEvidence';
import { fetchAsset, useAssetUrl } from '../../hooks/useAssetUrl';

/**
 * Photographic and documentary evidence for a case.
 *
 * IMAGES ARE FETCHED THROUGH A SIGNED URL PER ASSET, obtained on demand rather
 * than embedded in the list response. Those URLs are short-lived bearer tokens
 * for someone's home and identity documents; minting one for every asset on
 * every list render would leave a trail of live links in browser history and
 * in any log that records query strings.
 *
 * Each fetch is audited server-side, which is the point: who looked at a
 * customer's ID card, and when, is part of the record.
 */
export default function CaseEvidence({ investigationId, status }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [preview, setPreview] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['media', investigationId],
    queryFn: async () =>
      (await api.get('/media', { params: { investigationId, limit: 200 } })).data,
  });

  const remove = useMutation({
    mutationFn: async (assetId) =>
      (await api.delete(`/media/${assetId}`, { data: {} })).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['media', investigationId] });
    },
    onError: (mutationError) => toast.error(mutationError),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="evidence-grid placeholder-glow">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className="placeholder rounded" style={{ height: 130 }} />
        ))}
      </div>
    );
  }

  const assets = data?.data ?? [];
  const photos = assets.filter((asset) =>
    ['PHOTO', 'SIGNATURE'].includes(asset.mediaType),
  );
  const documents = assets.filter((asset) =>
    ['DOCUMENT', 'AUDIO', 'VIDEO'].includes(asset.mediaType),
  );

  const approved = ['QC_APPROVED', 'REPORT_GENERATION', 'COMPLETED', 'ARCHIVED'].includes(
    status,
  );

  return (
    <>
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <h2 className="h6 mb-0">{t('media.photos')}</h2>
        {can(P.MEDIA_UPLOAD) && (
          <UploadEvidence investigationId={investigationId} mediaType="PHOTO" />
        )}
      </div>
      {photos.length === 0 ? (
        <EmptyState title={t('media.noPhotos')} icon="camera" />
      ) : (
        <div className="evidence-grid mb-4">
          {photos.map((asset) => (
            <figure key={asset.id} className="evidence-tile mb-0">
              <button
                type="button"
                className="btn p-0 border-0 w-100"
                onClick={() => setPreview(asset)}
              >
                <AssetImage assetId={asset.id} alt={asset.fileName} />
              </button>
              <figcaption className="small mt-1">
                <div className="truncate fw-medium">
                  {asset.category
                    ? localisedName(asset.category, i18n.language)
                    : asset.fileName}
                </div>
                {asset.capturedAt && (
                  <div className="text-body-secondary">
                    {new Date(asset.capturedAt).toLocaleString(i18n.language)}
                  </div>
                )}
                {can(P.MEDIA_DELETE) && !approved && (
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-danger p-0"
                    onClick={() => setDeleting(asset)}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <h2 className="h6 mb-0">{t('media.documents')}</h2>
        {can(P.MEDIA_UPLOAD) && (
          <UploadEvidence investigationId={investigationId} mediaType="DOCUMENT" />
        )}
      </div>
      {documents.length === 0 ? (
        <EmptyState title={t('media.noDocuments')} icon="file-earmark" />
      ) : (
        <ul className="doc-list">
          {documents.map((asset) => {
            const kind = fileKind(asset);
            return (
              <li key={asset.id} className="doc-item">
                <span className={`doc-item__icon doc-${kind.key}`} aria-hidden="true">
                  <i className={`bi bi-${kind.icon}`} />
                  <span className="doc-item__ext">{kind.label}</span>
                </span>
                <span className="doc-item__text">
                  {/* dir="auto": an Arabic name reads right to left even on
                      the English screen, and an English one the other way. */}
                  <span className="doc-item__name" dir="auto" title={asset.fileName}>
                    {asset.fileName}
                  </span>
                  <span className="doc-item__meta">
                    <span>{formatSize(asset.sizeBytes)}</span>
                    {asset.category && <span>{localisedName(asset.category, i18n.language)}</span>}
                    {asset.createdAt && (
                      <span>
                        {new Date(asset.createdAt).toLocaleDateString(
                          i18n.language === 'en' ? 'en-GB' : 'ar-EG',
                        )}
                      </span>
                    )}
                  </span>
                  {asset.caption && (
                    <span className="doc-item__caption" dir="auto">
                      {asset.caption}
                    </span>
                  )}
                </span>
                <span className="doc-item__actions">
                  {can(P.MEDIA_DOWNLOAD) && kind.previewable && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => setViewing(asset)}
                    >
                      <i className="bi bi-eye me-1" aria-hidden="true" />
                      {t('media.open')}
                    </button>
                  )}
                  {can(P.MEDIA_DOWNLOAD) && <DownloadButton asset={asset} />}
                  {can(P.MEDIA_DELETE) && !approved && (
                    <button
                      type="button"
                      className="btn btn-sm btn-icon text-danger"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      onClick={() => setDeleting(asset)}
                    >
                      <i className="bi bi-trash" aria-hidden="true" />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {viewing && <DocumentViewer asset={viewing} onClose={() => setViewing(null)} />}

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        size="modal-lg"
        title={
          preview?.category
            ? localisedName(preview.category, i18n.language)
            : preview?.fileName
        }
      >
        {preview && (
          <>
            <AssetImage assetId={preview.id} alt={preview.fileName} full />
            <dl className="row small mt-3 mb-0">
              <dt className="col-4">{t('media.capturedAt')}</dt>
              <dd className="col-8">
                {preview.capturedAt
                  ? new Date(preview.capturedAt).toLocaleString(i18n.language)
                  : '—'}
              </dd>
              {preview.captureLat != null && (
                <>
                  <dt className="col-4">{t('gps.coordinates')}</dt>
                  <dd className="col-8 mono">
                    {preview.captureLat}, {preview.captureLng}
                  </dd>
                </>
              )}
            </dl>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting.id)}
        title={t('common.delete')}
        message={t('media.deleteConfirm')}
        busy={remove.isPending}
      />
    </>
  );
}

/**
 * Fetches a signed URL for one asset when it is first rendered.
 *
 * Kept as its own component so each tile requests its own URL lazily, and so a
 * failure to load one photo does not take the grid down with it.
 */
function AssetImage({ assetId, alt, full = false }) {
  const { t } = useTranslation();
  const { isLoading, isError, url } = useAssetUrl(assetId);

  if (isLoading || (!isError && !url)) {
    return (
      <span
        className="placeholder d-block rounded w-100"
        style={{ height: full ? 400 : 130 }}
      />
    );
  }

  if (isError) {
    return (
      <div
        className="d-flex align-items-center justify-content-center bg-body-tertiary rounded"
        style={{ height: full ? 400 : 130 }}
      >
        <span className="small text-body-secondary">{t('common.error')}</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      style={
        full
          ? { width: '100%', maxHeight: '70vh', objectFit: 'contain' }
          : { width: '100%', height: 130, objectFit: 'cover' }
      }
      className="rounded"
      loading="lazy"
    />
  );
}

/** Type, icon and colour for a document row, from its MIME type. */
function fileKind(asset) {
  const mime = asset.mimeType ?? '';
  const ext = (asset.fileName?.split('.').pop() ?? '').toUpperCase().slice(0, 4);
  if (mime === 'application/pdf') {
    return { key: 'pdf', icon: 'file-earmark-pdf', label: 'PDF', previewable: true };
  }
  if (mime.includes('wordprocessing')) {
    return { key: 'word', icon: 'file-earmark-word', label: 'DOCX', previewable: false };
  }
  if (mime.includes('spreadsheet')) {
    return { key: 'excel', icon: 'file-earmark-excel', label: 'XLSX', previewable: false };
  }
  if (mime.startsWith('image/')) {
    return { key: 'image', icon: 'file-earmark-image', label: ext || 'IMG', previewable: true };
  }
  if (mime.startsWith('audio/')) {
    return { key: 'media', icon: 'file-earmark-music', label: ext || 'AUD', previewable: true };
  }
  if (mime.startsWith('video/')) {
    return { key: 'media', icon: 'file-earmark-play', label: ext || 'VID', previewable: true };
  }
  return { key: 'other', icon: 'file-earmark', label: ext || 'FILE', previewable: false };
}

function formatSize(bytes) {
  const size = bytes ?? 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/**
 * Read a PDF, image or recording inside the page, in a large dialog.
 *
 * In the page rather than a new tab: a new tab is a navigation that a
 * download manager can intercept, and it loses the case around it.
 */
function DocumentViewer({ asset, onClose }) {
  const { t } = useTranslation();
  const { url, isLoading, isError } = useAssetUrl(asset?.id, asset?.mimeType);
  const mime = asset?.mimeType ?? '';

  let body;
  if (isError) {
    body = <p className="text-danger small mb-0">{t('common.error')}</p>;
  } else if (isLoading || !url) {
    body = (
      <div className="doc-viewer__loading">
        <span className="spinner-border" aria-hidden="true" />
      </div>
    );
  } else if (mime.startsWith('image/')) {
    body = <img src={url} alt={asset.fileName} className="doc-viewer__image" />;
  } else if (mime.startsWith('audio/')) {
    body = <audio src={url} controls className="w-100" />;
  } else if (mime.startsWith('video/')) {
    body = <video src={url} controls className="doc-viewer__video" />;
  } else {
    body = <iframe src={url} title={asset.fileName} className="doc-viewer__frame" />;
  }

  return (
    <Modal
      open={Boolean(asset)}
      onClose={onClose}
      size="modal-xl"
      title={
        <span dir="auto" className="text-truncate d-inline-block" style={{ maxWidth: '60vw' }}>
          {asset?.fileName}
        </span>
      }
      footer={
        <>
          {asset && <DownloadButton asset={asset} />}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      {body}
    </Modal>
  );
}

/**
 * Save a file. Fetched the same way as the viewer — opaque bytes, no file
 * name — and saved from a typed Blob under the name we already know. A plain
 * attachment request was being grabbed by a download manager, which left the
 * page with an empty reply that the browser saved as "file.xml".
 */
function DownloadButton({ asset }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const file = await fetchAsset(asset.id, { inline: true, mimeType: asset.mimeType });
      if (file.url) {
        window.open(file.url, '_blank', 'noopener,noreferrer');
      } else {
        if (!file.blob?.size) {
          toast.error(t('media.emptyDownload'));
          return;
        }
        const url = URL.createObjectURL(file.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = asset.fileName || 'file';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary flex-shrink-0"
      onClick={download}
      disabled={busy}
    >
      <i className="bi bi-download me-1" aria-hidden="true" />
      {t('media.download')}
    </button>
  );
}
