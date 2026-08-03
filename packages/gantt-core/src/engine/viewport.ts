import { clamp } from '../util/search';
import type { GanttId, ViewportState } from '../types';
import type { EngineContext } from './context';

/**
 * Owns the visible window.
 *
 * The viewport is the single source of truth for pan/zoom/scroll: the renderer
 * derives axis extents from it rather than the other way round. Keeping it in
 * the store (instead of, say, an ECharts dataZoom component) means there is
 * exactly one place that can move the camera and no feedback loop between the
 * chart library and the engine.
 */
export class ViewportController<T = unknown, G = unknown> {
  constructor(private readonly ctx: EngineContext<T, G>) {}

  get state(): ViewportState {
    return this.ctx.store.getState().viewport;
  }

  /** Visible time span in ms. */
  get span(): number {
    const { timeStart, timeEnd } = this.state;
    return timeEnd - timeStart;
  }

  get maxScrollTop(): number {
    return Math.max(0, this.ctx.getLayout().totalHeight - this.state.height);
  }

  timeToPx(time: number): number {
    const { timeStart, width } = this.state;
    const span = this.span;
    return span > 0 ? ((time - timeStart) / span) * width : 0;
  }

  pxToTime(px: number): number {
    const { timeStart, width } = this.state;
    return width > 0 ? timeStart + (px / width) * this.span : timeStart;
  }

  /** Pixels per millisecond at the current zoom. */
  get scale(): number {
    const span = this.span;
    return span > 0 ? this.state.width / span : 0;
  }

  /** Content pixels → plot pixels. */
  contentToPx(y: number): number {
    return y - this.state.scrollTop;
  }

  /** Plot pixels → content pixels. */
  pxToContent(py: number): number {
    return py + this.state.scrollTop;
  }

  setSize(width: number, height: number): void {
    const current = this.state;
    if (current.width === width && current.height === height) return;
    this.patch({ width, height, scrollTop: clamp(current.scrollTop, 0, Math.max(0, this.ctx.getLayout().totalHeight - height)) });
  }

  setTimeRange(start: number, end: number): void {
    const { minTimeSpan, maxTimeSpan } = this.ctx.getOptions();
    const [domainStart, domainEnd] = this.ctx.getDomain();

    let span = clamp(end - start, minTimeSpan, maxTimeSpan);
    // Never zoom out past the domain unless the domain itself is smaller.
    const domainSpan = domainEnd - domainStart;
    if (domainSpan > 0) span = Math.min(span, Math.max(domainSpan, minTimeSpan));

    let timeStart = start;
    if (domainSpan > 0) timeStart = clamp(timeStart, domainStart, Math.max(domainStart, domainEnd - span));

    this.patch({ timeStart, timeEnd: timeStart + span });
  }

  /** Pan horizontally by a pixel amount. Positive moves the view forward in time. */
  panByPx(dx: number): void {
    if (dx === 0) return;
    const dt = this.span * (dx / Math.max(1, this.state.width));
    this.setTimeRange(this.state.timeStart + dt, this.state.timeEnd + dt);
  }

  panByTime(dt: number): void {
    if (dt === 0) return;
    this.setTimeRange(this.state.timeStart + dt, this.state.timeEnd + dt);
  }

  /**
   * Zoom keeping the time under `anchorPx` pinned to that pixel.
   * `factor < 1` zooms in.
   */
  zoomAt(factor: number, anchorPx: number): void {
    if (factor <= 0 || factor === 1) return;
    const { timeStart, width } = this.state;
    const span = this.span;
    const ratio = width > 0 ? clamp(anchorPx / width, 0, 1) : 0.5;
    const anchorTime = timeStart + span * ratio;
    const nextSpan = span * factor;
    this.setTimeRange(anchorTime - nextSpan * ratio, anchorTime + nextSpan * (1 - ratio));
  }

  scrollTo(top: number): void {
    const next = clamp(top, 0, this.maxScrollTop);
    if (next === this.state.scrollTop) return;
    this.patch({ scrollTop: next });
  }

  scrollBy(dy: number): void {
    if (dy === 0) return;
    this.scrollTo(this.state.scrollTop + dy);
  }

  /** Frame the whole time domain. */
  fitTime(paddingRatio = 0.02): void {
    const [start, end] = this.ctx.getDomain();
    const span = Math.max(end - start, this.ctx.getOptions().minTimeSpan);
    const pad = span * paddingRatio;
    this.setTimeRange(start - pad, end + pad);
  }

  /** Scroll a row into view, doing nothing when it is already fully visible. */
  scrollRowIntoView(rowIndex: number, padding = 0): void {
    const layout = this.ctx.getLayout();
    const row = layout.rows[rowIndex];
    if (!row) return;
    const { scrollTop, height } = this.state;
    if (row.y - padding < scrollTop) this.scrollTo(row.y - padding);
    else if (row.y + row.height + padding > scrollTop + height) {
      this.scrollTo(row.y + row.height + padding - height);
    }
  }

  /** Bring a task into view on both axes. */
  scrollTaskIntoView(id: GanttId, paddingRatio = 0.1): void {
    const model = this.ctx.getModel();
    const layout = this.ctx.getLayout();
    const index = model.taskIndexById.get(id);
    if (index === undefined) return;

    const rowIndex = layout.taskRow[index];
    if (rowIndex >= 0) this.scrollRowIntoView(rowIndex, 8);

    const start = model.starts[index];
    const end = model.ends[index];
    const { timeStart, timeEnd } = this.state;
    if (start >= timeStart && end <= timeEnd) return;

    const span = this.span;
    const pad = span * paddingRatio;
    if (start < timeStart) this.setTimeRange(start - pad, start - pad + span);
    else this.setTimeRange(end + pad - span, end + pad);
  }

  private patch(patch: Partial<ViewportState>): void {
    const current = this.state;
    const next: ViewportState = { ...current, ...patch };
    // Spreading always yields a fresh object, so compare fields before writing —
    // otherwise every no-op pan would notify the whole subscriber tree.
    if (
      next.timeStart === current.timeStart &&
      next.timeEnd === current.timeEnd &&
      next.scrollTop === current.scrollTop &&
      next.width === current.width &&
      next.height === current.height
    ) {
      return;
    }
    this.ctx.store.setState({ viewport: next });
    this.ctx.events.emit('viewport:change', next);
  }
}
