import {
  idleMinutesFrom,
  settleSilence,
  summarize,
  workDayOf,
} from './attendance.util';

const at = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00.000Z`);

describe('attendance arithmetic', () => {
  it('counts the WHOLE silence as idle once it passes the threshold', () => {
    // 20 minutes of nothing with a 15-minute threshold is 20 idle minutes,
    // not 5: counting only the overshoot would hand out a free quarter hour.
    expect(
      settleSilence(
        { lastActivityAt: at('09:00'), idleSeconds: 0, idlePeriods: 0 },
        at('09:20'),
        15,
      ),
    ).toEqual({ idleSeconds: 20 * 60, idlePeriods: 1 });
  });

  it('treats a silence under the threshold as work', () => {
    // Reading a file, a phone call: still at work.
    expect(
      settleSilence(
        { lastActivityAt: at('09:00'), idleSeconds: 60, idlePeriods: 1 },
        at('09:14'),
        15,
      ),
    ).toEqual({ idleSeconds: 60, idlePeriods: 1 });
  });

  it('shows the current idle stretch live on an open session', () => {
    const live = summarize(
      {
        checkInAt: at('08:00'),
        checkOutAt: null,
        lastActivityAt: at('09:00'),
        idleSeconds: 0,
        idlePeriods: 0,
      },
      at('09:30'),
      15,
    );
    expect(live).toEqual({
      totalSeconds: 90 * 60,
      idleSeconds: 30 * 60,
      workedSeconds: 60 * 60,
      idleNow: true,
    });
  });

  it('does not keep adding idle to a closed session', () => {
    const closed = summarize(
      {
        checkInAt: at('08:00'),
        checkOutAt: at('12:00'),
        lastActivityAt: at('09:00'),
        idleSeconds: 600,
        idlePeriods: 1,
      },
      at('18:00'),
      15,
    );
    expect(closed.totalSeconds).toBe(4 * 3600);
    expect(closed.idleSeconds).toBe(600);
    expect(closed.idleNow).toBe(false);
  });

  it('takes the work day from the company timezone, not UTC', () => {
    // 23:30 UTC is already 01:30 the next day in Cairo (UTC+2).
    expect(
      workDayOf(new Date('2026-11-24T23:30:00.000Z'), 'Africa/Cairo'),
    ).toBe('2026-11-25');
  });

  it('reads the threshold from settings, defaulting and clamping', () => {
    expect(idleMinutesFrom({})).toBe(15);
    expect(idleMinutesFrom(null)).toBe(15);
    expect(idleMinutesFrom({ attendanceIdleMinutes: 30 })).toBe(30);
    expect(idleMinutesFrom({ attendanceIdleMinutes: 1 })).toBe(5);
    expect(idleMinutesFrom({ attendanceIdleMinutes: 999 })).toBe(120);
    expect(idleMinutesFrom({ attendanceIdleMinutes: 'x' })).toBe(15);
  });
});
