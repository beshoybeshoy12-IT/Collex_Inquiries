import * as XLSX from 'xlsx';
import { neutraliseFormula } from '../imports/utils/row-validator';

/**
 * The attendance workbook: a per-employee summary over the period, then one
 * row per employee per day they attended.
 *
 * Durations are real Excel durations (fractions of a day, `[h]:mm`), not
 * text, so HR can sum and average them. Names and roles pass through
 * `neutraliseFormula`: a user named `=HYPERLINK(...)` must open as text.
 *
 * The sheets are right-to-left for an Arabic reader.
 */

export interface ReportDay {
  userId: string;
  day: string; // YYYY-MM-DD
  fullName: string;
  role: string;
  firstCheckInAt: Date | null;
  lastCheckOutAt: Date | null;
  open: boolean;
  sessions: number;
  workedSeconds: number;
  idleSeconds: number;
  idlePeriods: number;
  autoClosed: boolean;
}

export interface ReportPerson {
  userId: string;
  fullName: string;
  role: string;
}

const LABELS = {
  ar: {
    summary: 'الملخص',
    details: 'التفاصيل',
    name: 'الموظف',
    role: 'الدور',
    daysPresent: 'أيام الحضور',
    worked: 'الوقت الفعلي',
    idle: 'وقت الخمول',
    total: 'إجمالي الوقت',
    idlePeriods: 'مرات الخمول',
    avgWorked: 'متوسط الوقت الفعلي يوميًا',
    autoClosed: 'أيام بدون انصراف',
    day: 'التاريخ',
    firstIn: 'الحضور',
    lastOut: 'الانصراف',
    sessions: 'عدد الفترات',
    note: 'ملاحظة',
    stillIn: 'لم ينصرف بعد',
    closedBySystem: 'أغلقه النظام (لم يسجّل انصراف)',
    period: 'الفترة',
  },
  en: {
    summary: 'Summary',
    details: 'Details',
    name: 'Employee',
    role: 'Role',
    daysPresent: 'Days present',
    worked: 'Active time',
    idle: 'Idle time',
    total: 'Total time',
    idlePeriods: 'Idle periods',
    avgWorked: 'Average active time per day',
    autoClosed: 'Days without check-out',
    day: 'Date',
    firstIn: 'Check-in',
    lastOut: 'Check-out',
    sessions: 'Sessions',
    note: 'Note',
    stillIn: 'Still checked in',
    closedBySystem: 'Closed by the system (no check-out)',
    period: 'Period',
  },
};

const DURATION = '[h]:mm';

function duration(seconds: number): XLSX.CellObject {
  return { t: 'n', v: Math.max(0, seconds) / 86400, z: DURATION };
}

function text(value: string): XLSX.CellObject {
  return { t: 's', v: neutraliseFormula(value ?? '') };
}

function clock(at: Date | null, timeZone: string): XLSX.CellObject {
  if (!at) return { t: 's', v: '' };
  const value = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return { t: 's', v: value };
}

export function buildAttendanceWorkbook(input: {
  from: string;
  to: string;
  timeZone: string;
  language: string;
  people: ReportPerson[];
  days: ReportDay[];
}): Buffer {
  const L = input.language === 'en' ? LABELS.en : LABELS.ar;

  // ── Summary ────────────────────────────────────────────────────────────
  const byPerson = new Map<string, ReportDay[]>();
  for (const day of input.days) {
    byPerson.set(day.userId, [...(byPerson.get(day.userId) ?? []), day]);
  }

  const summaryRows: XLSX.CellObject[][] = [
    [text(`${L.period}: ${input.from} → ${input.to}`)],
    [],
    [
      L.name,
      L.role,
      L.daysPresent,
      L.worked,
      L.idle,
      L.total,
      L.idlePeriods,
      L.avgWorked,
      L.autoClosed,
    ].map(text),
  ];

  for (const person of input.people) {
    const days = byPerson.get(person.userId) ?? [];
    const worked = days.reduce((s, d) => s + d.workedSeconds, 0);
    const idle = days.reduce((s, d) => s + d.idleSeconds, 0);
    summaryRows.push([
      text(person.fullName),
      text(person.role),
      { t: 'n', v: days.length },
      duration(worked),
      duration(idle),
      duration(worked + idle),
      { t: 'n', v: days.reduce((s, d) => s + d.idlePeriods, 0) },
      duration(days.length ? worked / days.length : 0),
      { t: 'n', v: days.filter((d) => d.autoClosed).length },
    ]);
  }

  // ── Details ────────────────────────────────────────────────────────────
  const detailRows: XLSX.CellObject[][] = [
    [
      L.day,
      L.name,
      L.role,
      L.firstIn,
      L.lastOut,
      L.sessions,
      L.worked,
      L.idle,
      L.idlePeriods,
      L.note,
    ].map(text),
  ];

  const sorted = [...input.days].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.fullName.localeCompare(b.fullName),
  );
  for (const day of sorted) {
    detailRows.push([
      text(day.day),
      text(day.fullName),
      text(day.role),
      clock(day.firstCheckInAt, input.timeZone),
      clock(day.lastCheckOutAt, input.timeZone),
      { t: 'n', v: day.sessions },
      duration(day.workedSeconds),
      duration(day.idleSeconds),
      { t: 'n', v: day.idlePeriods },
      text(day.open ? L.stillIn : day.autoClosed ? L.closedBySystem : ''),
    ]);
  }

  const summary = XLSX.utils.aoa_to_sheet(summaryRows);
  summary['!cols'] = [28, 18, 12, 14, 14, 14, 12, 22, 16].map((wch) => ({
    wch,
  }));
  const details = XLSX.utils.aoa_to_sheet(detailRows);
  details['!cols'] = [12, 28, 18, 10, 10, 10, 14, 14, 12, 30].map((wch) => ({
    wch,
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summary, L.summary);
  XLSX.utils.book_append_sheet(workbook, details, L.details);
  if (input.language !== 'en') {
    workbook.Workbook = { Views: [{ RTL: true }] };
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
