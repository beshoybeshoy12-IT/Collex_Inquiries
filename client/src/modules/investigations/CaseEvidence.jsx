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
      <h2 className="h6 mb-2">{t('media.photos')}</h2>
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

      <h2 className="h6 mb-2">{t('media.documents')}</h2>
      {documents.length === 0 ? (
        <EmptyState title={t('media.noDocuments')} icon="file-earmark" />
      ) : (
        <ul className="list-group">
          {documents.map((asset) => (
            <li
              key={asset.id}
              className="list-group-item d-flex justify-content-between align-items-center gap-2"
            >
              <span className="min-vw-0">
                <i className="bi bi-file-earmark me-2" aria-hidden="true" />
                <span className="truncate">{asset.fileName}</span>
                <span className="small text-body-secondary ms-2">
                  {Math.round((asset.sizeBytes ?? 0) / 1024)} KB
                </span>
              </span>
              {can(P.MEDIA_DOWNLOAD) && <DownloadButton assetId={asset.id} />}
            </li>
          ))}
        </ul>
      )}

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

  const { data, isLoading, isError } = useQuery({
    queryKey: ['media-url', assetId],
    queryFn: async () => (await api.get(`/media/${assetId}/download`)).data,
    // Signed URLs expire; refetch well before they do rather than showing a
    // broken image.
    staleTime: 10 * 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <span
        className="placeholder d-block rounded w-100"
        style={{ height: full ? 400 : 130 }}
      />
    );
  }

  if (isError || !data?.url) {
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
      src={data.url}
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

function DownloadButton({ assetId }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const { data } = await api.get(`/media/${assetId}/download`);
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
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
