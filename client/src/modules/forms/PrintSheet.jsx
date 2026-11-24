import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import ErrorState from '../../components/ErrorState';
import InquirySheet from './InquirySheet';
import { sheetHeader } from './sheetHeader';
import { useCaseClient } from '../../hooks/useClients';

/**
 * The printable inquiry sheet, on a page of its own.
 *
 * Its own route, outside the application layout, so what prints is the sheet
 * and nothing else — no sidebar, no header, no toast that happened to be on
 * screen. It opens in a new tab and calls the browser's print dialog once the
 * sheet has rendered; the toolbar stays on screen for a second copy and
 * never reaches the paper.
 *
 *   /print/investigation/:id          the case's form, filled in
 *   /print/investigation/:id?blank=1  the case's form, empty, case facts printed
 *   /print/form/:id                   a form template, entirely blank
 */
export function PrintCaseSheet() {
  const { id } = useParams();
  const [params] = useSearchParams();
  // `?form=<templateId>` prints another form under this case's header. Its
  // answers belong to the case's own form, so that sheet is always blank.
  const otherFormId = params.get('form');
  const blank = params.get('blank') === '1' || Boolean(otherFormId);
  const { t, i18n } = useTranslation();

  const investigation = useQuery({
    queryKey: ['investigation', id],
    queryFn: async () => (await api.get(`/investigations/${id}`)).data,
  });

  const caseForm = useQuery({
    queryKey: ['case-form', id],
    queryFn: async () => (await api.get(`/forms/investigation/${id}`)).data,
    retry: false,
    enabled: !otherFormId,
  });

  const otherForm = useQuery({
    queryKey: ['form-template', otherFormId],
    queryFn: async () => {
      const template = (await api.get(`/forms/${otherFormId}`)).data;
      const published = template.versions?.find(
        (version) => version.id === template.publishedVersionId,
      );
      return published
        ? { nameAr: template.nameAr, nameEn: template.nameEn, schema: published.schema }
        : null;
    },
    enabled: Boolean(otherFormId),
  });

  const form = otherFormId ? otherForm : caseForm;
  const error =
    investigation.error ||
    form.error ||
    (otherFormId && otherForm.data === null ? t('inquirySheet.notPublished') : null);
  // Printing starts on its own once the sheet is ready, so "ready" includes
  // the client's logo — otherwise the first page comes out without it.
  const caseClient = useCaseClient(investigation.data);
  const ready = investigation.data && form.data && caseClient.ready;

  return (
    <PrintFrame
      ready={Boolean(ready)}
      error={error}
      onRetry={() => {
        investigation.refetch();
        form.refetch();
      }}
    >
      {ready && (
        <InquirySheet
          title={localisedName(form.data, i18n.language)}
          header={sheetHeader(t, investigation.data)}
          schema={form.data.schema}
          answers={form.data.submission?.answers ?? {}}
          blank={blank}
          brand={caseClient}
        />
      )}
    </PrintFrame>
  );
}

export function PrintBlankForm() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();

  const template = useQuery({
    queryKey: ['form-template', id],
    queryFn: async () => (await api.get(`/forms/${id}`)).data,
  });

  const published = template.data?.versions?.find(
    (version) => version.id === template.data.publishedVersionId,
  );

  return (
    <PrintFrame
      ready={Boolean(published)}
      error={
        template.error ||
        (template.data && !published ? t('inquirySheet.notPublished') : null)
      }
      onRetry={template.refetch}
    >
      {published && (
        <InquirySheet
          title={localisedName(template.data, i18n.language)}
          header={sheetHeader(t)}
          schema={published.schema}
          blank
        />
      )}
    </PrintFrame>
  );
}

function PrintFrame({ ready, error, onRetry, children }) {
  const { t } = useTranslation();
  const printed = useRef(false);

  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    // One frame for the icon font and layout to settle, or the first page
    // prints with empty boxes where the ticks should be.
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [ready]);

  return (
    <div className="ci-print-page">
      <div className="no-print d-flex justify-content-center gap-2 mb-3">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => window.print()}
          disabled={!ready}
        >
          <i className="bi bi-printer me-1" aria-hidden="true" />
          {t('inquirySheet.print')}
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => window.close()}>
          {t('common.close')}
        </button>
      </div>

      <div className="ci-print-paper">
        {error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : ready ? (
          children
        ) : (
          <div className="placeholder-glow">
            <span className="placeholder col-12 d-block" style={{ height: 400 }} />
          </div>
        )}
      </div>
    </div>
  );
}
