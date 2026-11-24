import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useAuth } from '../../app/AuthContext';
import { useToast } from '../../components/Toast';
import { useRealtime } from '../../hooks/useRealtime';
import Modal from '../../components/Modal';
import UserAvatar from '../../components/UserAvatar';
import { localisedName } from '../../i18n';
import { P } from '../../utils/permissions';
import { initialsOf, shortDuration, timeOfDay } from '../../utils/duration';

const STATUS_FILTERS = ['all', 'IN', 'OUT', 'ABSENT'];
const COUNT_KEY = { IN: 'in', OUT: 'out', ABSENT: 'absent' };

function rowState(row) {
  if (row.status === 'IN') return row.idleNow ? 'idle' : 'in';
  return row.status === 'OUT' ? 'out' : 'none';
}

/**
 * Everybody's attendance for one day — shown only to `attendance.view_all`
 * (the server refuses everyone else; this component is not mounted for them).
 *
 * Who is in, who has left, who has not come; and for each, first in, last
 * out, active and idle time, with a bar comparing active time across the
 * team. The Excel button exports any period up to 92 days.
 */
export default function TeamAttendance() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const language = i18n.language;

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-team', date],
    queryFn: async () =>
      (await api.get('/attendance/team', { params: date ? { date } : {} })).data,
    refetchInterval: 60_000,
  });

  useRealtime('attendance:changed', () => {
    queryClient.invalidateQueries({ queryKey: ['attendance-team'] });
  });

  const rows = (data?.rows ?? []).filter((row) => status === 'all' || row.status === status);
  const maxWorked = useMemo(
    () => Math.max(1, ...(data?.rows ?? []).map((row) => row.totals.workedSeconds)),
    [data],
  );
  const idleNow = (data?.rows ?? []).filter((row) => row.idleNow).length;

  return (
    <div className="card mt-3 team-attendance">
      <div className="card-header bg-body d-flex flex-wrap align-items-center justify-content-between gap-2 py-2">
        <span className="fw-semibold d-inline-flex align-items-center gap-2">
          <span className="panel-icon" aria-hidden="true">
            <i className="bi bi-people" />
          </span>
          {t('home.team.title')}
        </span>

        <div className="d-flex flex-wrap align-items-center gap-2">
          <input
            type="date"
            className="form-control form-control-sm w-auto"
            value={date || data?.day || ''}
            onChange={(event) => setDate(event.target.value)}
            aria-label={t('home.team.date')}
          />
          <button
            type="button"
            className="btn btn-sm btn-outline-success"
            onClick={() => setExportOpen(true)}
          >
            <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
            {t('home.team.export')}
          </button>
          {can(P.SETTINGS_MANAGE) && (
            <button
              type="button"
              className="btn btn-sm btn-icon"
              title={t('home.team.settings')}
              aria-label={t('home.team.settings')}
              onClick={() => setSettingsOpen(true)}
            >
              <i className="bi bi-gear" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Counters double as the status filter. */}
      <div className="team-counters">
        {STATUS_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={`team-counter team-counter-${key.toLowerCase()} ${
              status === key ? 'active' : ''
            }`}
            onClick={() => setStatus(key)}
            aria-pressed={status === key}
          >
            <span className="team-counter__value">
              {key === 'all' ? (data?.rows.length ?? 0) : (data?.counts[COUNT_KEY[key]] ?? 0)}
            </span>
            <span className="team-counter__label">{t(`home.team.filters.${key}`)}</span>
            {key === 'IN' && idleNow > 0 && (
              <span className="team-counter__note">
                {t('home.team.idleNow', { count: idleNow })}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="table-responsive">
        <table className="table table-hover align-middle mb-0 team-table">
          <thead>
            <tr>
              <th>{t('home.team.employee')}</th>
              <th>{t('home.team.status')}</th>
              <th className="text-center">{t('home.firstIn')}</th>
              <th className="text-center">{t('home.lastOut')}</th>
              <th style={{ minWidth: 170 }}>{t('home.worked')}</th>
              <th className="text-center">{t('home.idle')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="text-center py-4">
                  <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-body-secondary py-4">
                  {t('home.team.empty')}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const state = rowState(row);
                const present = row.sessions > 0;
                return (
                  <tr key={row.userId} className={present ? '' : 'team-row-absent'}>
                    <td>
                      <span className="d-inline-flex align-items-center gap-2">
                        <UserAvatar initials={initialsOf(row.fullName)} className="avatar-sm" />
                        <span className="min-vw-0">
                          <span className="d-block fw-semibold text-truncate">
                            {row.fullName}
                          </span>
                          {row.role && (
                            <span className="d-block small text-body-tertiary">
                              {localisedName(row.role)}
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className={`attendance-state attendance-state-${state}`}>
                        <span className="attendance-dot" aria-hidden="true" />
                        {t(state === 'idle' ? 'home.state.idle' : `home.team.statuses.${row.status}`)}
                      </span>
                      {row.autoClosed && (
                        <i
                          className="bi bi-moon-stars ms-2 text-body-tertiary"
                          title={t('home.autoClosed')}
                          aria-label={t('home.autoClosed')}
                        />
                      )}
                    </td>
                    <td className="text-center">
                      <span className="time-chip">{timeOfDay(row.firstCheckInAt, language)}</span>
                    </td>
                    <td className="text-center">
                      {row.status === 'IN' ? (
                        <span className="small text-success-emphasis">{t('home.team.stillIn')}</span>
                      ) : (
                        <span className="time-chip">{timeOfDay(row.lastCheckOutAt, language)}</span>
                      )}
                    </td>
                    <td>
                      {present ? (
                        <div className="worked-cell">
                          <span className="worked-cell__value">
                            {shortDuration(row.totals.workedSeconds, language)}
                          </span>
                          <span className="worked-bar" aria-hidden="true">
                            <span
                              className="worked-bar__fill"
                              style={{
                                inlineSize: `${(row.totals.workedSeconds / maxWorked) * 100}%`,
                              }}
                            />
                          </span>
                        </div>
                      ) : (
                        <span className="text-body-tertiary">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      {present ? (
                        <span className="text-warning-emphasis fw-semibold">
                          {shortDuration(row.totals.idleSeconds, language)}
                          {row.idlePeriods > 0 && (
                            <span className="d-block small fw-normal text-body-tertiary">
                              {t('home.team.periods', { count: row.idlePeriods })}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-body-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {settingsOpen && (
        <IdleSettings current={data?.idleMinutes ?? 15} onClose={() => setSettingsOpen(false)} />
      )}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}

/** "2026-11-24" in local time. */
function isoDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function presets() {
  const today = new Date();
  const weekStart = new Date(today);
  // The work week starts on Saturday here (Sunday–Thursday business days).
  weekStart.setDate(today.getDate() - ((today.getDay() + 1) % 7));
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return {
    today: [isoDay(today), isoDay(today)],
    week: [isoDay(weekStart), isoDay(today)],
    month: [isoDay(monthStart), isoDay(today)],
    lastMonth: [isoDay(lastMonthStart), isoDay(lastMonthEnd)],
  };
}

/** Pick a period and download the Excel report. */
function ExportDialog({ onClose }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const ranges = useMemo(presets, []);
  const [[from, to], setRange] = useState(ranges.month);

  const download = useMutation({
    mutationFn: async () => {
      const response = await api.get('/attendance/team/export', {
        params: { from, to, lang: i18n.language === 'en' ? 'en' : 'ar' },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance-${from}_${to}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onSuccess: () => {
      toast.success(t('home.team.exported'));
      onClose();
    },
    onError: async (error) => {
      // A blob error body has to be read before its message can be shown.
      let message = error.friendlyMessage;
      try {
        const body = JSON.parse(await error.response?.data?.text?.());
        message = Array.isArray(body.message) ? body.message.join('\n') : body.message;
      } catch {
        // keep the generic message
      }
      toast.error(localiseServerMessage(message ?? t('errors.unknown')));
    },
  });

  const days = (new Date(to) - new Date(from)) / 86_400_000 + 1;
  const valid = from && to && from <= to && days <= 92;

  return (
    <Modal
      open
      onClose={onClose}
      busy={download.isPending}
      title={t('home.team.exportTitle')}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-success"
            disabled={!valid || download.isPending}
            onClick={() => download.mutate()}
          >
            {download.isPending ? (
              <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
            ) : (
              <i className="bi bi-download me-1" aria-hidden="true" />
            )}
            {t('home.team.download')}
          </button>
        </>
      }
    >
      <div className="d-flex flex-wrap gap-2 mb-3">
        {Object.entries(ranges).map(([key, range]) => (
          <button
            key={key}
            type="button"
            className={`btn btn-sm ${
              range[0] === from && range[1] === to ? 'btn-primary' : 'btn-outline-secondary'
            }`}
            onClick={() => setRange(range)}
          >
            {t(`home.team.presets.${key}`)}
          </button>
        ))}
      </div>
      <div className="row g-3">
        <div className="col-6">
          <label className="form-label" htmlFor="export-from">
            {t('home.team.from')}
          </label>
          <input
            id="export-from"
            type="date"
            className="form-control"
            value={from}
            max={to}
            onChange={(event) => setRange([event.target.value, to])}
          />
        </div>
        <div className="col-6">
          <label className="form-label" htmlFor="export-to">
            {t('home.team.to')}
          </label>
          <input
            id="export-to"
            type="date"
            className="form-control"
            value={to}
            min={from}
            onChange={(event) => setRange([from, event.target.value])}
          />
        </div>
      </div>
      <div className={`form-text ${valid ? '' : 'text-danger'}`}>
        {valid ? t('home.team.exportHint') : t('home.team.exportTooLong')}
      </div>
    </Modal>
  );
}

function IdleSettings({ current, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [minutes, setMinutes] = useState(current);

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch('/attendance/settings', { idleMinutes: Number(minutes) })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-team'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-today'] });
      toast.success(t('common.saved'));
      onClose();
    },
    onError: (error) =>
      toast.error(localiseServerMessage(error.friendlyMessage ?? t('errors.unknown'))),
  });

  const valid = Number.isInteger(Number(minutes)) && minutes >= 5 && minutes <= 120;

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      title={t('home.team.settings')}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <label className="form-label" htmlFor="idle-minutes">
        {t('home.team.idleMinutes')}
      </label>
      <div className="input-group" style={{ maxWidth: 220 }}>
        <input
          id="idle-minutes"
          type="number"
          min={5}
          max={120}
          className="form-control"
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
        />
        <span className="input-group-text">{t('home.team.minutes')}</span>
      </div>
      <div className="form-text">{t('home.team.idleHint')}</div>
    </Modal>
  );
}
