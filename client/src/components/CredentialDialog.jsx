import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';

/**
 * Shows a generated password exactly once.
 *
 * The server generates it, hashes it, and returns the plaintext in that one
 * response — it is never stored anywhere it can be read back, which is why an
 * administrator cannot look it up later and why this dialog says so plainly.
 *
 * Closing is deliberately gated behind an acknowledgement checkbox. Somebody
 * who dismisses this by reflex has locked out the user they just created, and
 * the only remedy is another reset.
 */
export default function CredentialDialog({ credential, onClose }) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!credential) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(credential.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the value is on screen either way.
    }
  };

  const close = () => {
    setAcknowledged(false);
    setCopied(false);
    onClose();
  };

  return (
    <Modal
      open
      onClose={acknowledged ? close : () => {}}
      closeOnBackdrop={false}
      title={t('investigators.temporaryPassword')}
      footer={
        <button
          type="button"
          className="btn btn-primary"
          onClick={close}
          disabled={!acknowledged}
        >
          {t('common.close')}
        </button>
      }
    >
      <div className="alert alert-warning py-2 px-3 small">
        <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
        {t('investigators.temporaryPasswordHint')}
      </div>

      <dl className="row mb-3">
        <dt className="col-4 small text-body-secondary">{t('common.name')}</dt>
        <dd className="col-8">{credential.title}</dd>

        <dt className="col-4 small text-body-secondary">
          {credential.identifierLabel ?? t('investigators.employeeCode')}
        </dt>
        <dd className="col-8 mono">{credential.identifier}</dd>
      </dl>

      <div className="input-group">
        <input
          className="form-control mono fw-semibold"
          dir="ltr"
          readOnly
          value={credential.password}
          onFocus={(event) => event.target.select()}
        />
        <button type="button" className="btn btn-outline-secondary" onClick={copy}>
          <i className={`bi bi-${copied ? 'check-lg' : 'clipboard'}`} aria-hidden="true" />
          <span className="ms-1">{copied ? t('common.copied') : t('common.copy')}</span>
        </button>
      </div>

      <div className="form-check mt-3">
        <input
          className="form-check-input"
          type="checkbox"
          id="acknowledge-credential"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <label className="form-check-label small" htmlFor="acknowledge-credential">
          {t('common.copied')} — {t('investigators.temporaryPasswordHint')}
        </label>
      </div>
    </Modal>
  );
}
