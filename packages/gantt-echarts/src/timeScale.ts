/**
 * Calendar-aware time scale.
 *
 * The engine owns the visible time window, so ticks are derived from it rather
 * than from a chart-library axis. Everything here is a pure function of
 * `(timeStart, timeEnd, width)`, which is what lets the canvas grid lines and
 * the React header agree on tick positions without passing state between them.
 *
 * Steps walk the *calendar* (via `Date` field arithmetic) instead of adding a
 * fixed number of milliseconds, so day boundaries stay at local midnight across
 * a DST change and month bands keep their real lengths.
 */

export type TimeUnit =
    | 'millisecond'
    | 'second'
    | 'minute'
    | 'hour'
    | 'day'
    | 'week'
    | 'month'
    | 'quarter'
    | 'year';

export interface TimeTick {
    /** Boundary time, epoch ms. */
    time: number;
    /** Position in plot pixels. */
    x: number;
    label: string;
    unit: TimeUnit;
    /** True when this tick opens a new period of the next coarser unit. */
    major: boolean;
}

export interface TimeTickScale {
    unit: TimeUnit;
    /** Number of `unit`s between ticks. */
    step: number;
    ticks: TimeTick[];
}

/** A labelled span in the header's coarse tier. */
export interface TimeBand {
    time: number;
    /** Left edge in plot pixels, clipped to the plot area. */
    x: number;
    width: number;
    label: string;
    unit: TimeUnit;
    /** False when the band starts or ends outside the visible window. */
    complete: boolean;
}

export interface TimeScaleInput {
    timeStart: number;
    timeEnd: number;
    /** Plot width in pixels. */
    width: number;
    /** Desired pixel distance between ticks; the step is chosen around it. */
    targetPx?: number;
    locale?: string;
    /** 0 = Sunday, 1 = Monday. */
    weekStartsOn?: 0 | 1;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30.436875 * DAY;
const YEAR = 365.2425 * DAY;

interface Candidate {
    unit: TimeUnit;
    step: number;
    /** Nominal length, used only to choose a step. */
    ms: number;
}

/**
 * Steps a reader expects to see on a time axis. Deliberately excludes awkward
 * multiples (7 hours, 4 days) — a "nice" scale is one whose labels are round.
 */
const CANDIDATES: readonly Candidate[] = [
    {unit: 'millisecond', step: 1, ms: 1},
    {unit: 'millisecond', step: 2, ms: 2},
    {unit: 'millisecond', step: 5, ms: 5},
    {unit: 'millisecond', step: 10, ms: 10},
    {unit: 'millisecond', step: 20, ms: 20},
    {unit: 'millisecond', step: 50, ms: 50},
    {unit: 'millisecond', step: 100, ms: 100},
    {unit: 'millisecond', step: 200, ms: 200},
    {unit: 'millisecond', step: 500, ms: 500},
    {unit: 'second', step: 1, ms: SECOND},
    {unit: 'second', step: 2, ms: 2 * SECOND},
    {unit: 'second', step: 5, ms: 5 * SECOND},
    {unit: 'second', step: 10, ms: 10 * SECOND},
    {unit: 'second', step: 15, ms: 15 * SECOND},
    {unit: 'second', step: 30, ms: 30 * SECOND},
    {unit: 'minute', step: 1, ms: MINUTE},
    {unit: 'minute', step: 2, ms: 2 * MINUTE},
    {unit: 'minute', step: 5, ms: 5 * MINUTE},
    {unit: 'minute', step: 10, ms: 10 * MINUTE},
    {unit: 'minute', step: 15, ms: 15 * MINUTE},
    {unit: 'minute', step: 30, ms: 30 * MINUTE},
    {unit: 'hour', step: 1, ms: HOUR},
    {unit: 'hour', step: 2, ms: 2 * HOUR},
    {unit: 'hour', step: 3, ms: 3 * HOUR},
    {unit: 'hour', step: 6, ms: 6 * HOUR},
    {unit: 'hour', step: 12, ms: 12 * HOUR},
    {unit: 'day', step: 1, ms: DAY},
    {unit: 'day', step: 3, ms: 3 * DAY},
    {unit: 'day', step: 5, ms: 5 * DAY},
    {unit: 'week', step: 1, ms: WEEK},
    {unit: 'week', step: 2, ms: 2 * WEEK},
    {unit: 'month', step: 1, ms: MONTH},
    {unit: 'quarter', step: 1, ms: 3 * MONTH},
    {unit: 'year', step: 1, ms: YEAR},
    {unit: 'year', step: 2, ms: 2 * YEAR},
    {unit: 'year', step: 5, ms: 5 * YEAR},
    {unit: 'year', step: 10, ms: 10 * YEAR},
    {unit: 'year', step: 25, ms: 25 * YEAR},
    {unit: 'year', step: 50, ms: 50 * YEAR},
    {unit: 'year', step: 100, ms: 100 * YEAR},
];

/** The next coarser unit, used for the header's upper tier and `major` ticks. */
export function parentUnit(unit: TimeUnit): TimeUnit {
    switch (unit) {
        case 'millisecond':
            return 'second';
        case 'second':
            return 'minute';
        case 'minute':
            return 'hour';
        case 'hour':
            return 'day';
        case 'day':
        case 'week':
            return 'month';
        case 'month':
        case 'quarter':
            return 'year';
        default:
            return 'year';
    }
}

/** Nominal length of one unit in ms. Approximate for month/quarter/year. */
export function unitLength(unit: TimeUnit, step = 1): number {
    switch (unit) {
        case 'millisecond':
            return step;
        case 'second':
            return step * SECOND;
        case 'minute':
            return step * MINUTE;
        case 'hour':
            return step * HOUR;
        case 'day':
            return step * DAY;
        case 'week':
            return step * WEEK;
        case 'month':
            return step * MONTH;
        case 'quarter':
            return step * 3 * MONTH;
        default:
            return step * YEAR;
    }
}

/** Round `time` down to a boundary of `unit`/`step`, in local time. */
export function floorTo(time: number, unit: TimeUnit, step = 1, weekStartsOn: 0 | 1 = 1): number {
    const date = new Date(time);
    switch (unit) {
        case 'millisecond':
            return Math.floor(time / step) * step;
        case 'second':
            date.setMilliseconds(0);
            date.setSeconds(Math.floor(date.getSeconds() / step) * step);
            return date.getTime();
        case 'minute':
            date.setSeconds(0, 0);
            date.setMinutes(Math.floor(date.getMinutes() / step) * step);
            return date.getTime();
        case 'hour':
            date.setMinutes(0, 0, 0);
            date.setHours(Math.floor(date.getHours() / step) * step);
            return date.getTime();
        case 'day':
            date.setHours(0, 0, 0, 0);
            return date.getTime();
        case 'week': {
            date.setHours(0, 0, 0, 0);
            const shift = (date.getDay() - weekStartsOn + 7) % 7;
            date.setDate(date.getDate() - shift);
            return date.getTime();
        }
        case 'month':
            date.setHours(0, 0, 0, 0);
            date.setDate(1);
            return date.getTime();
        case 'quarter':
            date.setHours(0, 0, 0, 0);
            date.setDate(1);
            date.setMonth(Math.floor(date.getMonth() / 3) * 3);
            return date.getTime();
        default: {
            date.setHours(0, 0, 0, 0);
            date.setMonth(0, 1);
            if (step > 1) date.setFullYear(Math.floor(date.getFullYear() / step) * step);
            return date.getTime();
        }
    }
}

/** Advance `time` by `step` units, in local time. `step` may be negative. */
export function addUnits(time: number, unit: TimeUnit, step: number): number {
    const date = new Date(time);
    switch (unit) {
        case 'millisecond':
            return time + step;
        case 'second':
            return time + step * SECOND;
        case 'minute':
            return time + step * MINUTE;
        case 'hour':
            return time + step * HOUR;
        case 'day':
            date.setDate(date.getDate() + step);
            return date.getTime();
        case 'week':
            date.setDate(date.getDate() + step * 7);
            return date.getTime();
        case 'month':
            date.setMonth(date.getMonth() + step);
            return date.getTime();
        case 'quarter':
            date.setMonth(date.getMonth() + step * 3);
            return date.getTime();
        default:
            date.setFullYear(date.getFullYear() + step);
            return date.getTime();
    }
}

/** Smallest nice step whose on-screen spacing is at least `targetPx`. */
export function chooseStep(spanMs: number, width: number, targetPx: number): Candidate {
    const last = CANDIDATES[CANDIDATES.length - 1];
    if (spanMs <= 0 || width <= 0) return last;
    const msPerPx = spanMs / width;
    const minMs = msPerPx * targetPx;
    for (const candidate of CANDIDATES) {
        if (candidate.ms >= minMs) return candidate;
    }
    return last;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale ?? ''}|${JSON.stringify(options)}`;
    let cached = formatterCache.get(key);
    if (!cached) {
        cached = new Intl.DateTimeFormat(locale, options);
        formatterCache.set(key, cached);
    }
    return cached;
}

function pad(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

/** ISO-8601 week number. */
export function isoWeek(time: number): number {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    // Thursday of the current ISO week decides which year/week it belongs to.
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const firstThursday = new Date(date.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
    return 1 + Math.round((date.getTime() - firstThursday.getTime()) / WEEK);
}

export interface FormatOptions {
    locale?: string;
    /** Compact labels drop redundant context (the year on a month tick, …). */
    compact?: boolean;
}

/** Label for a boundary at `unit` granularity. */
export function formatTime(time: number, unit: TimeUnit, options: FormatOptions = {}): string {
    const {locale, compact = true} = options;
    const date = new Date(time);

    switch (unit) {
        case 'millisecond':
            return `.${String(date.getMilliseconds()).padStart(3, '0')}`;
        case 'second':
            return `${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        case 'minute':
        case 'hour':
            return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        case 'day':
            return compact
                ? String(date.getDate())
                : formatter(locale, {day: 'numeric', month: 'short'}).format(date);
        case 'week':
            return compact ? `W${isoWeek(time)}` : `W${isoWeek(time)} · ${formatter(locale, {
                day: 'numeric',
                month: 'short'
            }).format(date)}`;
        case 'month':
            return compact
                ? formatter(locale, {month: 'short'}).format(date)
                : formatter(locale, {month: 'long', year: 'numeric'}).format(date);
        case 'quarter':
            return `Q${Math.floor(date.getMonth() / 3) + 1}${compact ? '' : ` ${date.getFullYear()}`}`;
        default:
            return String(date.getFullYear());
    }
}

/**
 * Ticks for the visible window.
 *
 * One tick before `timeStart` is intentionally omitted — grid lines outside the
 * plot area are not drawn — but bands (see {@link computeTimeBands}) do start
 * before it so a partially visible month still gets a label.
 */
export function computeTimeTicks(input: TimeScaleInput): TimeTickScale {
    const {timeStart, timeEnd, width, targetPx = 88, locale, weekStartsOn = 1} = input;
    const span = timeEnd - timeStart;
    const {unit, step} = chooseStep(span, width, targetPx);
    const ticks: TimeTick[] = [];
    if (span <= 0 || width <= 0) return {unit, step, ticks};

    const scale = width / span;
    const parent = parentUnit(unit);
    let time = floorTo(timeStart, unit, step, weekStartsOn);
    if (time < timeStart) time = addUnits(time, unit, step);

    // A misconfigured window (or a pathological zoom) must not spin forever.
    const guard = Math.ceil(width / 2) + 8;

    while (time <= timeEnd && ticks.length < guard) {
        const previous = addUnits(time, unit, -step);
        ticks.push({
            time,
            x: (time - timeStart) * scale,
            label: formatTime(time, unit, {locale, compact: true}),
            unit,
            major: floorTo(time, parent, 1, weekStartsOn) !== floorTo(previous, parent, 1, weekStartsOn),
        });
        const next = addUnits(time, unit, step);
        if (next <= time) break;
        time = next;
    }

    return {unit, step, ticks};
}

export interface TimeBandInput extends TimeScaleInput {
    unit: TimeUnit;
    step?: number;
}

/**
 * Labelled spans covering the visible window — the header's coarse tier.
 *
 * Unlike ticks, the first band starts *before* `timeStart` when the window opens
 * mid-period, so its label stays visible; `x` is clipped to the plot area and
 * `complete` reports whether the span was cut.
 */
export function computeTimeBands(input: TimeBandInput): TimeBand[] {
    const {timeStart, timeEnd, width, unit, step = 1, locale, weekStartsOn = 1} = input;
    const span = timeEnd - timeStart;
    const bands: TimeBand[] = [];
    if (span <= 0 || width <= 0) return bands;

    const scale = width / span;
    let time = floorTo(timeStart, unit, step, weekStartsOn);
    const guard = Math.ceil(width / 2) + 8;

    while (time < timeEnd && bands.length < guard) {
        const next = addUnits(time, unit, step);
        if (next <= time) break;

        const rawX = (time - timeStart) * scale;
        const rawRight = (next - timeStart) * scale;
        const x = Math.max(0, rawX);
        const right = Math.min(width, rawRight);

        bands.push({
            time,
            x,
            width: Math.max(0, right - x),
            label: formatTime(time, unit, {locale, compact: false}),
            unit,
            complete: rawX >= 0 && rawRight <= width,
        });
        time = next;
    }

    return bands;
}

/**
 * The two tiers a Gantt header shows: fine ticks plus the coarser bands above
 * them. Both are derived from the same chosen step, so they always line up.
 */
export interface TimeHeaderModel {
    scale: TimeTickScale;
    bands: TimeBand[];
    bandUnit: TimeUnit;
}

export function computeTimeHeader(input: TimeScaleInput): TimeHeaderModel {
    const scale = computeTimeTicks(input);
    const bandUnit = parentUnit(scale.unit);
    return {scale, bands: computeTimeBands({...input, unit: bandUnit, step: 1}), bandUnit};
}

/* ------------------------------------------------- clicking a header label */

/**
 * Periods a header-label click steps through, coarsest first.
 *
 * Deliberately shorter than {@link TimeUnit}: this is a navigation ladder for a
 * *schedule*, where year / quarter / month / week are the spans people actually
 * ask to see. Sub-day rungs would make a click land somewhere no Gantt reader
 * was aiming for.
 */
export type ZoomRung = 'year' | 'quarter' | 'month' | 'week' | 'day';

const ZOOM_LADDER: readonly ZoomRung[] = ['year', 'quarter', 'month', 'week', 'day'];

/**
 * The period a click zooms *to*, chosen from how much is currently visible.
 *
 * Keyed on the visible span rather than on which unit the clicked label happens
 * to be, and that is what guarantees a click always zooms in. Consider a
 * 300-day window running June→April: two year labels are on screen, but zooming
 * to either whole year would *widen* the view. Reading the span instead yields
 * `quarter`, so the click narrows as the user expects.
 *
 * Thresholds are nominal (`YEAR` is 365.2425 days), so a 365-day window counts
 * as just under a year and lands on `quarter`.
 *
 * `day` is the floor. Without it a window narrower than a week would map to
 * `week` and a click would zoom out.
 */
export function labelZoomRung(spanMs: number): ZoomRung {
    if (spanMs >= YEAR) return 'year';
    if (spanMs >= 3 * MONTH) return 'quarter';
    if (spanMs >= MONTH) return 'month';
    if (spanMs >= WEEK) return 'week';
    return 'day';
}

/** What a click on a header label should do to the viewport. */
export type LabelZoomAction =
/** Show exactly this period. */
    | { kind: 'range'; start: number; end: number; unit: ZoomRung }
    /**
     * Zooming out past `year` has no coarser period to land on, so the whole time
     * domain is the only sensible next step. The engine knows the domain; this
     * module does not.
     */
    | { kind: 'fit' };

export interface LabelZoomInput {
    /** The visible window, which decides the granularity. */
    timeStart: number;
    timeEnd: number;
    /** Boundary time of the clicked label — a `TimeTick.time` or `TimeBand.time`. */
    time: number;
    /** `out` is the ctrl/cmd-click gesture: the same ladder, one rung coarser. */
    direction: 'in' | 'out';
    weekStartsOn?: 0 | 1;
}

/** The real calendar period of `unit` containing `time`. */
function periodAt(
    time: number,
    unit: ZoomRung,
    weekStartsOn: 0 | 1,
): { start: number; end: number } | null {
    const start = floorTo(time, unit, 1, weekStartsOn);
    const end = addUnits(start, unit, 1);
    return end > start ? {start, end} : null;
}

/**
 * Resolve a header-label click into a viewport move.
 *
 * Pure, so the ladder can be tested without a chart: the caller applies the
 * result through `viewport.setTimeRange` (or `viewport.fitTime`) and lets the
 * engine clamp to the domain and to min/max span.
 *
 * The clicked label only locates the period — the *containing* one at the target
 * granularity. Clicking "Mar" in an eight-month view zooms to the quarter March
 * sits in, not to March.
 *
 * The rung from {@link labelZoomRung} is a starting guess, and the walk below is
 * what makes the gesture trustworthy: it keeps stepping until the period is
 * genuinely narrower (or wider) than what is on screen. Nominal thresholds
 * cannot promise that, because real periods vary — a 31-day January sits above
 * the 30.44-day `MONTH` threshold, so it maps to `month`, and zooming to the
 * very month already framed would move nothing. The same trap catches 92-day
 * quarters and 366-day leap years. Verifying against the actual period closes
 * all three, so a click never silently does nothing.
 */
export function labelZoomAction(input: LabelZoomInput): LabelZoomAction | null {
    const {timeStart, timeEnd, time, direction, weekStartsOn = 1} = input;
    const span = timeEnd - timeStart;
    if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(time)) return null;

    const from = ZOOM_LADDER.indexOf(labelZoomRung(span));

    if (direction === 'in') {
        for (let i = from; i < ZOOM_LADDER.length; i++) {
            const unit = ZOOM_LADDER[i];
            const range = periodAt(time, unit, weekStartsOn);
            if (range && range.end - range.start < span) return {kind: 'range', ...range, unit};
        }
        // Already at or below a day: there is no finer rung to offer.
        return null;
    }

    for (let i = from - 1; i >= 0; i--) {
        const unit = ZOOM_LADDER[i];
        const range = periodAt(time, unit, weekStartsOn);
        if (range && range.end - range.start > span) return {kind: 'range', ...range, unit};
    }
    // Nothing coarser fits, so the whole domain is the only step left.
    return {kind: 'fit'};
}
