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
