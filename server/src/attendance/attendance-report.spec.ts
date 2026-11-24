import * as XLSX from 'xlsx';
import { buildAttendanceWorkbook } from './attendance-report';

const read = (buffer: Buffer) => XLSX.read(buffer, { type: 'buffer' });

describe('attendance workbook', () => {
  const day = (overrides = {}) => ({
    userId: 'u1',
    day: '2026-11-24',
    fullName: 'Mona',
    role: 'Coordinator',
    firstCheckInAt: new Date('2026-11-24T06:05:00.000Z'), // 08:05 Cairo
    lastCheckOutAt: new Date('2026-11-24T14:00:00.000Z'), // 16:00 Cairo
    open: false,
    sessions: 1,
    workedSeconds: 7 * 3600,
    idleSeconds: 30 * 60,
    idlePeriods: 2,
    autoClosed: false,
    ...overrides,
  });

  it('writes durations as real Excel durations that HR can sum', () => {
    const wb = read(
      buildAttendanceWorkbook({
        from: '2026-11-24',
        to: '2026-11-25',
        timeZone: 'Africa/Cairo',
        language: 'en',
        people: [{ userId: 'u1', fullName: 'Mona', role: 'Coordinator' }],
        days: [day(), day({ day: '2026-11-25' })],
      }),
    );

    const summary = wb.Sheets.Summary;
    // Row 4 is Mona: two days, 14h active, average 7h.
    expect(summary.C4.v).toBe(2);
    expect(summary.D4.v).toBeCloseTo((14 * 3600) / 86400);
    expect(summary.H4.v).toBeCloseTo((7 * 3600) / 86400);

    const details = wb.Sheets.Details;
    expect(details.D2.v).toBe('08:05'); // company timezone, not UTC
    expect(details.E2.v).toBe('16:00');
  });

  it('opens a formula-looking name as text', () => {
    const wb = read(
      buildAttendanceWorkbook({
        from: '2026-11-24',
        to: '2026-11-24',
        timeZone: 'Africa/Cairo',
        language: 'en',
        people: [{ userId: 'u1', fullName: '=HYPERLINK("x")', role: '' }],
        days: [day({ fullName: '=HYPERLINK("x")' })],
      }),
    );
    expect(wb.Sheets.Summary.A4.v).toBe('\'=HYPERLINK("x")');
    expect(wb.Sheets.Summary.A4.f).toBeUndefined();
  });

  it('keeps someone who never came in the summary, with zero days', () => {
    const wb = read(
      buildAttendanceWorkbook({
        from: '2026-11-24',
        to: '2026-11-24',
        timeZone: 'Africa/Cairo',
        language: 'ar',
        people: [
          { userId: 'u1', fullName: 'Mona', role: '' },
          { userId: 'u2', fullName: 'Omar', role: '' },
        ],
        days: [day()],
      }),
    );
    expect(wb.SheetNames).toEqual(['الملخص', 'التفاصيل']);
    expect(wb.Sheets['الملخص'].C5.v).toBe(0);
  });
});
