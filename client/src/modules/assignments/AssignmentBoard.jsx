import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import PageHeader, { Panel } from '../../components/PageHeader';
import DataTable from '../../components/DataTable';
import ErrorState from '../../components/ErrorState';
import { PriorityBadge, SlaBadge, AvailabilityBadge } from '../../components/Badges';
import AssignModal from './AssignModal';

/**
 * The assignment board.
 *
 * Unassigned work on one side, investigator capacity on the other. That pairing
 * is the whole job: a coordinator deciding who takes what needs to see the
 * queue and the load at the same time, and a screen that shows one without the
 * other sends them back and forth between two pages.
 *
 * MANUAL ASSIGNMENT IS THE WORKFLOW. Nothing here assigns on its own; the
 * ranked suggestions inside the dialog are advice a coordinator can take or
 * ignore.
 */
export default function AssignmentBoard() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [page, setPage] = useState(1);

  const {
    data: queue,
    isLoading: loadingQueue,
    error: queueError,
    refetch,
  } = useQuery({
    queryKey: ['unassigned-cases', page],
    queryFn: async () =>
      (
        await api.get('/investigations', {
          params: {
            statusGroup: 'UNASSIGNED',
            page,
            limit: 25,
            sortBy: 'dueAt',
            sortOrder: 'asc',
          },
        })
      ).data,
    refetchInterval: 60_000,
  });

  const { data: workload, isLoading: loadingWorkload } = useQuery({
    queryKey: ['assignment-workload'],
    queryFn: async () => (await api.get('/assignments/workload')).data,
    refetchInterval: 60_000,
  });

  if (queueError) return <ErrorState error={queueError} onRetry={refetch} />;

  const columns = [
    {
      key: 'caseNumber',
      header: t('cases.caseNumber'),
      render: (row) => (
        <Link
          to={`/investigations/${row.id}`}
          className="mono fw-semibold text-decoration-none"
        >
          {row.caseNumber}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: t('cases.customer'),
      render: (row) => row.customer?.fullName ?? '—',
    },
    {
      key: 'investigationType',
      header: t('cases.investigationType'),
      render: (row) => localisedName(row.investigationType, i18n.language),
    },
    {
      key: 'governorate',
      header: t('cases.governorate'),
      render: (row) => localisedName(row.governorate, i18n.language) || '—',
    },
    {
      key: 'priority',
      header: t('cases.priority'),
      render: (row) => <PriorityBadge priority={row.priority} />,
    },
    {
      key: 'sla',
      header: t('cases.sla'),
      render: (row) => <SlaBadge sla={row.sla} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('assignment.title')}
        subtitle={
          queue?.meta ? `${queue.meta.total} ${t('nav.unassigned').toLowerCase()}` : undefined
        }
        actions={
          selected.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setAssigning(true)}
            >
              <i className="bi bi-person-check me-1" aria-hidden="true" />
              {t('assignment.bulkAssign')} ({selected.length})
            </button>
          )
        }
      />

      <div className="row g-3">
        <div className="col-12 col-xl-8">
          <Panel title={t('nav.unassigned')} bodyClassName="p-2">
            <DataTable
              columns={columns}
              rows={queue?.data}
              meta={queue?.meta}
              loading={loadingQueue}
              onPageChange={setPage}
              selectable
              selectedIds={selected}
              onSelectionChange={setSelected}
              emptyTitle={t('cases.noCases')}
              compact
            />
          </Panel>
        </div>

        <div className="col-12 col-xl-4">
          <Panel title={t('dashboard.workload')} bodyClassName="p-0">
            {loadingWorkload ? (
              <div className="p-3 placeholder-glow">
                {[1, 2, 3, 4].map((n) => (
                  <span key={n} className="placeholder col-12 d-block mb-2" style={{ height: 40 }} />
                ))}
              </div>
            ) : (
              <ul className="list-group list-group-flush">
                {(workload ?? []).map((investigator) => (
                  <li key={investigator.id} className="list-group-item">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="min-vw-0">
                        <Link
                          to={`/investigators/${investigator.id}`}
                          className="fw-medium text-decoration-none d-block truncate"
                        >
                          {investigator.fullName}
                        </Link>
                        <div className="small text-body-secondary">
                          <span className="mono">{investigator.employeeCode}</span>
                          {investigator.qualityScore != null && (
                            <span className="ms-2">
                              <i className="bi bi-star-fill text-warning me-1" aria-hidden="true" />
                              {investigator.qualityScore}%
                            </span>
                          )}
                        </div>
                      </div>
                      <AvailabilityBadge availability={investigator.availability} />
                    </div>

                    <div className="d-flex align-items-center gap-2 mt-2">
                      <div className="progress flex-grow-1" style={{ height: 6 }}>
                        <div
                          className={`progress-bar ${
                            investigator.atCapacity
                              ? 'bg-danger'
                              : investigator.capacityUsedPercent > 70
                                ? 'bg-warning'
                                : 'bg-success'
                          }`}
                          style={{
                            width: `${Math.min(100, investigator.capacityUsedPercent ?? 0)}%`,
                          }}
                        />
                      </div>
                      <span className="small text-body-secondary text-nowrap">
                        {investigator.openCases}/{investigator.maxOpenCases}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <AssignModal
        open={assigning}
        onClose={() => setAssigning(false)}
        investigationIds={selected}
        onDone={() => {
          setSelected([]);
          queryClient.invalidateQueries({ queryKey: ['unassigned-cases'] });
          queryClient.invalidateQueries({ queryKey: ['assignment-workload'] });
          queryClient.invalidateQueries({ queryKey: ['investigation-counts'] });
        }}
      />
    </>
  );
}
