import { describe, expect, it } from 'vitest';
import {
  addUnits,
  chooseStep,
  computeTimeBands,
  computeTimeHeader,
  computeTimeTicks,
  floorTo,
  formatTime,
  isoWeek,
  labelZoomAction,
  labelZoomRung,
  parentUnit,
  unitLength,
  type TimeUnit,
} from '../src/timeScale';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MARCH_2026 = new Date(2026, 2, 2).getTime(); // Monday 2 March 2026, local.

describe('chooseStep', () => {
  it('picks a step whose on-screen spacing clears the target', () => {
    const cases: { span: number; width: number }[] = [
      { span: 2 * MINUTE, width: 900 },
      { span: 6 * HOUR, width: 900 },
      { span: 10 * DAY, width: 900 },
      { span: 400 * DAY, width: 1200 },
      { span: 40 * 365 * DAY, width: 600 },
    ];

    for (const { span, width } of cases) {
      const candidate = chooseStep(span, width, 88);
      const px = (candidate.ms / span) * width;
      expect(px, `${span}ms over ${width}px`).toBeGreaterThanOrEqual(88);
    }
  });

  it('never returns a step smaller than one millisecond', () => {
    const candidate = chooseStep(1, 1000, 88);
    expect(candidate.unit).toBe('millisecond');
    expect(candidate.step).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the coarsest step for degenerate input', () => {
    expect(chooseStep(0, 800, 88).unit).toBe('year');
    expect(chooseStep(1000, 0, 88).unit).toBe('year');
    // Beyond the largest candidate there is nothing coarser to pick.
    expect(chooseStep(1e15, 100, 88).unit).toBe('year');
  });
});

describe('floorTo / addUnits', () => {
  it('floors to local boundaries', () => {
    const time = new Date(2026, 2, 17, 13, 47, 33, 456).getTime();

    expect(new Date(floorTo(time, 'second')).getMilliseconds()).toBe(0);
    expect(new Date(floorTo(time, 'minute')).getSeconds()).toBe(0);
    const hour = new Date(floorTo(time, 'hour'));
    expect([hour.getMinutes(), hour.getSeconds(), hour.getMilliseconds()]).toEqual([0, 0, 0]);

    const day = new Date(floorTo(time, 'day'));
    expect([day.getHours(), day.getDate()]).toEqual([0, 17]);

    const month = new Date(floorTo(time, 'month'));
    expect([month.getDate(), month.getMonth()]).toEqual([1, 2]);

    const quarter = new Date(floorTo(time, 'quarter'));
    expect([quarter.getDate(), quarter.getMonth()]).toEqual([1, 0]);

    const year = new Date(floorTo(time, 'year'));
    expect([year.getDate(), year.getMonth(), year.getFullYear()]).toEqual([1, 0, 2026]);
  });

  it('floors weeks to the configured first day', () => {
    const wednesday = new Date(2026, 2, 18, 9).getTime();
    expect(new Date(floorTo(wednesday, 'week', 1, 1)).getDay()).toBe(1);
    expect(new Date(floorTo(wednesday, 'week', 1, 0)).getDay()).toBe(0);
    // Flooring is idempotent.
    const monday = floorTo(wednesday, 'week', 1, 1);
    expect(floorTo(monday, 'week', 1, 1)).toBe(monday);
  });

  it('floors sub-day units to a multiple of the step', () => {
    const time = new Date(2026, 2, 17, 13, 47).getTime();
    expect(new Date(floorTo(time, 'minute', 15)).getMinutes()).toBe(45);
    expect(new Date(floorTo(time, 'hour', 6)).getHours()).toBe(12);
    expect(new Date(floorTo(time, 'year', 10)).getFullYear()).toBe(2020);
  });

  it('walks the calendar rather than adding fixed milliseconds', () => {
    // February is 28 days in 2026; a fixed +30d would land in the wrong month.
    const february = new Date(2026, 1, 1).getTime();
    expect(new Date(addUnits(february, 'month', 1)).getMonth()).toBe(2);
    expect(new Date(addUnits(february, 'month', 1)).getDate()).toBe(1);

    const leapDay = new Date(2024, 1, 29).getTime();
    const nextYear = new Date(addUnits(leapDay, 'year', 1));
    expect(nextYear.getFullYear()).toBe(2025);

    // Day steps keep local midnight even when a DST shift happens in between,
    // which a +86 400 000 would not.
    for (let i = 0; i < 400; i++) {
      const day = addUnits(new Date(2026, 0, 1).getTime(), 'day', i);
      expect(new Date(day).getHours(), `day +${i}`).toBe(0);
    }
  });

  it('supports negative steps', () => {
    const march = new Date(2026, 2, 1).getTime();
    expect(new Date(addUnits(march, 'month', -1)).getMonth()).toBe(1);
    expect(addUnits(1000, 'millisecond', -100)).toBe(900);
  });
});

describe('computeTimeTicks', () => {
  const input = { timeStart: MARCH_2026, timeEnd: MARCH_2026 + 10 * DAY, width: 900 };

  it('produces ordered ticks inside the window, mapped into the plot', () => {
    const { ticks, unit, step } = computeTimeTicks(input);
    expect(ticks.length).toBeGreaterThan(1);

    for (let i = 0; i < ticks.length; i++) {
      const tick = ticks[i];
      expect(tick.time).toBeGreaterThanOrEqual(input.timeStart);
      expect(tick.time).toBeLessThanOrEqual(input.timeEnd);
      expect(tick.x).toBeGreaterThanOrEqual(0);
      expect(tick.x).toBeLessThanOrEqual(input.width);
      // Every tick sits on a real boundary of its own unit.
      expect(floorTo(tick.time, unit, step)).toBe(tick.time);
      if (i > 0) expect(tick.time).toBeGreaterThan(ticks[i - 1].time);
    }
  });

  it('places x by linear interpolation of the window', () => {
    const { ticks } = computeTimeTicks(input);
    const scale = input.width / (input.timeEnd - input.timeStart);
    for (const tick of ticks) {
      expect(tick.x).toBeCloseTo((tick.time - input.timeStart) * scale, 6);
    }
  });

  it('puts day ticks on local midnight', () => {
    // 10 days over 900px lands on a one-day step at the default target spacing.
    const { ticks, unit } = computeTimeTicks(input);
    expect(unit).toBe('day');
    for (const tick of ticks) expect(new Date(tick.time).getHours()).toBe(0);
  });

  it('subdivides below a day when the window is short enough', () => {
    const { unit, step } = computeTimeTicks({ ...input, targetPx: 40 });
    expect(unit).toBe('hour');
    expect(step).toBe(12);
  });

  it('marks a tick major when it opens a new period of the coarser unit', () => {
    // A window straddling a month boundary, with daily ticks.
    const start = new Date(2026, 2, 25).getTime();
    const { ticks, unit } = computeTimeTicks({
      timeStart: start,
      timeEnd: new Date(2026, 3, 8).getTime(),
      width: 900,
      targetPx: 40,
    });
    expect(unit).toBe('day');

    const majors = ticks.filter((tick) => tick.major);
    expect(majors).toHaveLength(1);
    expect(new Date(majors[0].time).getDate()).toBe(1);
    expect(new Date(majors[0].time).getMonth()).toBe(3);
  });

  it('returns nothing for an empty or inverted window', () => {
    expect(computeTimeTicks({ ...input, width: 0 }).ticks).toEqual([]);
    expect(computeTimeTicks({ ...input, timeEnd: input.timeStart }).ticks).toEqual([]);
    expect(computeTimeTicks({ ...input, timeEnd: input.timeStart - DAY }).ticks).toEqual([]);
  });

  it('stays bounded on an extreme window instead of spinning', () => {
    const wide = computeTimeTicks({ timeStart: 0, timeEnd: 400 * 365 * DAY, width: 600 });
    expect(wide.ticks.length).toBeGreaterThan(0);
    expect(wide.ticks.length).toBeLessThanOrEqual(308);

    const narrow = computeTimeTicks({ timeStart: 0, timeEnd: 3, width: 1200 });
    expect(narrow.ticks.length).toBeLessThanOrEqual(608);
  });
});

describe('computeTimeBands', () => {
  const input = { timeStart: new Date(2026, 2, 14).getTime(), timeEnd: new Date(2026, 5, 3).getTime(), width: 1000 };

  it('covers the window edge to edge with no gaps', () => {
    const bands = computeTimeBands({ ...input, unit: 'month' });
    expect(bands.length).toBe(4); // March (partial), April, May, June (partial)
    expect(bands[0].x).toBe(0);
    expect(bands[bands.length - 1].x + bands[bands.length - 1].width).toBeCloseTo(input.width, 6);

    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].x).toBeCloseTo(bands[i - 1].x + bands[i - 1].width, 6);
    }
    const total = bands.reduce((sum, band) => sum + band.width, 0);
    expect(total).toBeCloseTo(input.width, 6);
  });

  it('starts the first band before the window so its label survives', () => {
    const bands = computeTimeBands({ ...input, unit: 'month' });
    expect(bands[0].time).toBeLessThan(input.timeStart);
    expect(new Date(bands[0].time).getDate()).toBe(1);
    // Clipped bands are reported as incomplete so the header can hide a label
    // that would otherwise sit off-centre.
    expect(bands[0].complete).toBe(false);
    expect(bands[bands.length - 1].complete).toBe(false);
    expect(bands[1].complete).toBe(true);
  });

  it('labels bands with full context', () => {
    const bands = computeTimeBands({ ...input, unit: 'month', locale: 'en-US' });
    expect(bands[1].label).toBe('April 2026');
    const quarters = computeTimeBands({ ...input, unit: 'quarter', locale: 'en-US' });
    expect(quarters[0].label).toBe('Q1 2026');
  });

  it('returns nothing for a degenerate window', () => {
    expect(computeTimeBands({ ...input, unit: 'month', width: 0 })).toEqual([]);
    expect(computeTimeBands({ ...input, unit: 'month', timeEnd: input.timeStart })).toEqual([]);
  });
});

describe('computeTimeHeader', () => {
  it('pairs the chosen tick unit with the next coarser band unit', () => {
    const header = computeTimeHeader({
      timeStart: MARCH_2026,
      timeEnd: MARCH_2026 + 10 * DAY,
      width: 900,
      locale: 'en-US',
    });

    expect(header.scale.unit).toBe('day');
    expect(header.bandUnit).toBe('month');
    expect(header.bands[0].label).toBe('March 2026');
    expect(header.bands.every((band) => band.width >= 0)).toBe(true);
  });
});

describe('parentUnit / unitLength', () => {
  it('climbs to the next coarser unit and stops at year', () => {
    const pairs: [TimeUnit, TimeUnit][] = [
      ['millisecond', 'second'],
      ['second', 'minute'],
      ['minute', 'hour'],
      ['hour', 'day'],
      ['day', 'month'],
      ['week', 'month'],
      ['month', 'year'],
      ['quarter', 'year'],
      ['year', 'year'],
    ];
    for (const [unit, parent] of pairs) expect(parentUnit(unit)).toBe(parent);
  });

  it('orders units by nominal length', () => {
    const order: TimeUnit[] = ['millisecond', 'second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
    for (let i = 1; i < order.length; i++) {
      expect(unitLength(order[i])).toBeGreaterThan(unitLength(order[i - 1]));
    }
    expect(unitLength('day', 3)).toBe(3 * DAY);
  });
});

describe('formatTime', () => {
  it('labels each unit at the right granularity', () => {
    const time = new Date(2026, 2, 17, 14, 5, 9, 123).getTime();
    expect(formatTime(time, 'millisecond')).toBe('.123');
    expect(formatTime(time, 'second')).toBe('05:09');
    expect(formatTime(time, 'minute')).toBe('14:05');
    expect(formatTime(time, 'hour')).toBe('14:05');
    expect(formatTime(time, 'day')).toBe('17');
    expect(formatTime(time, 'month', { locale: 'en-US' })).toBe('Mar');
    expect(formatTime(time, 'quarter')).toBe('Q1');
    expect(formatTime(time, 'year')).toBe('2026');
  });

  it('adds context when not compact', () => {
    const time = new Date(2026, 2, 17).getTime();
    expect(formatTime(time, 'day', { locale: 'en-US', compact: false })).toBe('Mar 17');
    expect(formatTime(time, 'month', { locale: 'en-US', compact: false })).toBe('March 2026');
    expect(formatTime(time, 'quarter', { compact: false })).toBe('Q1 2026');
  });

  it('numbers ISO weeks', () => {
    // 1 January 2026 is a Thursday, so it belongs to ISO week 1.
    expect(isoWeek(new Date(2026, 0, 1).getTime())).toBe(1);
    expect(isoWeek(new Date(2026, 0, 5).getTime())).toBe(2);
    // 2027-01-01 is a Friday: still week 53 of 2026.
    expect(isoWeek(new Date(2027, 0, 1).getTime())).toBe(53);
    expect(formatTime(new Date(2026, 0, 5).getTime(), 'week')).toBe('W2');
  });
});

/**
 * Clicking a header label. The ladder is year → quarter → month → week → day,
 * and every case below states the *visible span* first, because that — not the
 * unit of the label clicked — is what picks the rung.
 */
describe('labelZoomRung', () => {
  const DAYS = (n: number) => n * 86_400_000;

  it('reads a multi-year view as year', () => {
    expect(labelZoomRung(DAYS(365 * 5))).toBe('year');
    expect(labelZoomRung(DAYS(400))).toBe('year');
  });

  it('reads under a year as quarter', () => {
    expect(labelZoomRung(DAYS(300))).toBe('quarter');
    expect(labelZoomRung(DAYS(100))).toBe('quarter');
    // Nominal thresholds: 365 days is just under YEAR (365.2425 days).
    expect(labelZoomRung(DAYS(365))).toBe('quarter');
  });

  it('reads under three months as month', () => {
    expect(labelZoomRung(DAYS(80))).toBe('month');
    expect(labelZoomRung(DAYS(31))).toBe('month');
  });

  it('reads under a month as week', () => {
    expect(labelZoomRung(DAYS(20))).toBe('week');
    expect(labelZoomRung(DAYS(7))).toBe('week');
  });

  it('floors at day so a narrow view cannot zoom out on a click', () => {
    // Mapping a 3-day window to `week` would widen it — the opposite gesture.
    expect(labelZoomRung(DAYS(3))).toBe('day');
    expect(labelZoomRung(DAYS(0.5))).toBe('day');
  });
});

describe('labelZoomAction', () => {
  const at = (y: number, m = 0, d = 1) => new Date(y, m, d).getTime();

  it('zooms a multi-year view to the clicked year', () => {
    const action = labelZoomAction({
      timeStart: at(2024),
      timeEnd: at(2029),
      time: at(2026, 4, 17),
      direction: 'in',
    });
    expect(action).toEqual({ kind: 'range', start: at(2026), end: at(2027), unit: 'year' });
  });

  it('zooms an under-a-year view to the quarter containing the click', () => {
    // Clicking "Mar" yields Q1, not March: the span picks the granularity and
    // the label only locates the period.
    const action = labelZoomAction({
      timeStart: at(2026, 0, 1),
      timeEnd: at(2026, 7, 1),
      time: at(2026, 2, 1),
      direction: 'in',
    });
    expect(action).toEqual({ kind: 'range', start: at(2026, 0), end: at(2026, 3), unit: 'quarter' });
  });

  it('zooms an under-three-months view to the clicked month', () => {
    const action = labelZoomAction({
      timeStart: at(2026, 0, 1),
      timeEnd: at(2026, 1, 20),
      time: at(2026, 1, 12),
      direction: 'in',
    });
    expect(action).toEqual({ kind: 'range', start: at(2026, 1), end: at(2026, 2), unit: 'month' });
  });

  it('zooms an under-a-month view to the clicked week', () => {
    const action = labelZoomAction({
      timeStart: at(2026, 2, 1),
      timeEnd: at(2026, 2, 21),
      time: at(2026, 2, 11), // a Wednesday
      direction: 'in',
      weekStartsOn: 1,
    });
    // Monday-start week containing 11 March 2026 opens on the 9th.
    expect(action).toEqual({ kind: 'range', start: at(2026, 2, 9), end: at(2026, 2, 16), unit: 'week' });
  });

  it('honours weekStartsOn when landing on a week', () => {
    const input = {
      timeStart: at(2026, 2, 1),
      timeEnd: at(2026, 2, 21),
      time: at(2026, 2, 11),
      direction: 'in' as const,
    };
    expect(labelZoomAction({ ...input, weekStartsOn: 0 })).toMatchObject({ start: at(2026, 2, 8) });
    expect(labelZoomAction({ ...input, weekStartsOn: 1 })).toMatchObject({ start: at(2026, 2, 9) });
  });

  it('always narrows the view on a plain click', () => {
    const spans = [5, 1, 0.8, 0.25, 0.08, 0.02].map((years) => years * 365.2425 * 86_400_000);
    for (const span of spans) {
      const timeStart = at(2026, 3, 12);
      const action = labelZoomAction({
        timeStart,
        timeEnd: timeStart + span,
        time: timeStart + span / 2,
        direction: 'in',
      });
      if (!action || action.kind !== 'range') throw new Error('expected a range');
      expect(action.end - action.start).toBeLessThan(span);
    }
  });

  /* ------------------------------------------------------- ctrl-click: out */

  it('steps one rung coarser on a zoom out', () => {
    const out = (timeStart: number, timeEnd: number) =>
      labelZoomAction({ timeStart, timeEnd, time: at(2026, 4, 17), direction: 'out' });

    // week-level view → the containing month
    expect(out(at(2026, 4, 1), at(2026, 4, 20))).toMatchObject({ unit: 'month' });
    // month-level → quarter
    expect(out(at(2026, 4, 1), at(2026, 5, 20))).toMatchObject({ unit: 'quarter' });
    // quarter-level → year
    expect(out(at(2026, 0, 1), at(2026, 8, 1))).toMatchObject({ unit: 'year' });
    // day-level → week
    expect(out(at(2026, 4, 16), at(2026, 4, 19))).toMatchObject({ unit: 'week' });
  });

  it('widens to the whole domain once the ladder runs out', () => {
    // Already at `year`, so there is no coarser period to land on.
    const action = labelZoomAction({
      timeStart: at(2024),
      timeEnd: at(2029),
      time: at(2026),
      direction: 'out',
    });
    expect(action).toEqual({ kind: 'fit' });
  });

  it('always widens the view on a ctrl-click', () => {
    const spans = [0.02, 0.08, 0.25, 0.8].map((years) => years * 365.2425 * 86_400_000);
    for (const span of spans) {
      const timeStart = at(2026, 3, 12);
      const action = labelZoomAction({
        timeStart,
        timeEnd: timeStart + span,
        time: timeStart + span / 2,
        direction: 'out',
      });
      if (!action || action.kind !== 'range') throw new Error('expected a range');
      expect(action.end - action.start).toBeGreaterThan(span);
    }
  });

  /*
   * Nominal thresholds vs real calendar lengths. Each window below is *exactly*
   * one period long, so the rung it maps to would zoom to the period already
   * framed and move nothing. A click that does nothing reads as broken, so the
   * action has to step past it.
   */
  it('does not stall on a 31-day month', () => {
    // January is 31 days, above the 30.44-day MONTH threshold, so it reads as
    // `month` — the very month already on screen.
    const action = labelZoomAction({
      timeStart: at(2026, 0, 1),
      timeEnd: at(2026, 1, 1),
      time: at(2026, 0, 15),
      direction: 'in',
    });
    expect(action).toMatchObject({ kind: 'range', unit: 'week' });
    if (!action || action.kind !== 'range') throw new Error('expected a range');
    expect(action.end - action.start).toBeLessThan(at(2026, 1, 1) - at(2026, 0, 1));
  });

  it('does not stall on a 92-day quarter', () => {
    // Q3 2026 is 92 days, above the 91.31-day threshold for `quarter`.
    const action = labelZoomAction({
      timeStart: at(2026, 6, 1),
      timeEnd: at(2026, 9, 1),
      time: at(2026, 7, 15),
      direction: 'in',
    });
    expect(action).toMatchObject({ kind: 'range', unit: 'month' });
  });

  it('does not stall on a 366-day leap year', () => {
    const action = labelZoomAction({
      timeStart: at(2028, 0, 1),
      timeEnd: at(2029, 0, 1),
      time: at(2028, 5, 15),
      direction: 'in',
    });
    expect(action).toMatchObject({ kind: 'range', unit: 'quarter' });
  });

  it('does not stall zooming out of an exact period either', () => {
    // One whole month framed: the month rung cannot widen it.
    const action = labelZoomAction({
      timeStart: at(2026, 0, 1),
      timeEnd: at(2026, 1, 1),
      time: at(2026, 0, 15),
      direction: 'out',
    });
    expect(action).toMatchObject({ kind: 'range', unit: 'quarter' });
  });

  it('offers nothing finer than a day', () => {
    const start = at(2026, 2, 11);
    expect(
      labelZoomAction({ timeStart: start, timeEnd: start + 6 * 3_600_000, time: start, direction: 'in' }),
    ).toBeNull();
  });

  it('refuses a degenerate window rather than guessing', () => {
    const base = { time: at(2026), direction: 'in' as const };
    expect(labelZoomAction({ ...base, timeStart: at(2026), timeEnd: at(2026) })).toBeNull();
    expect(labelZoomAction({ ...base, timeStart: at(2027), timeEnd: at(2026) })).toBeNull();
    expect(labelZoomAction({ ...base, timeStart: 0, timeEnd: Number.NaN })).toBeNull();
    expect(labelZoomAction({ timeStart: at(2024), timeEnd: at(2029), time: Number.NaN, direction: 'in' })).toBeNull();
  });
});
