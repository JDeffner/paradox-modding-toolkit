/**
 * Arrow-key nudges: what a key means, and how a held key becomes ONE op.
 *
 * PURE apart from the timer (injected, so a test can drive it). The shell
 * turns a keydown into a vector here, feeds it to a `NudgeBurst`, and the
 * burst calls `commit` once per trailing window of `NUDGE_BURST_MS`. That is
 * what keeps the undo honest: a key held for a second is one gesture to the
 * user, so it is one document change and one undo step, not forty.
 *
 * A burst never fires while the previous commit is still in flight (`busy`):
 * the op would add its delta to source values the file has already left. It
 * keeps accumulating and re-arms until the host has answered.
 */

/** The trailing quiet time after which a burst commits, in ms. */
export const NUDGE_BURST_MS = 250;

/** A nudge with no modifier moves one world pixel; Shift ten; Alt one grid step. */
export function nudgeStep(mods: { shiftKey: boolean; altKey: boolean }, grid: number): number {
  if (mods.altKey) return grid;
  return mods.shiftKey ? 10 : 1;
}

/** The world delta an arrow key asks for, or null for any other key. */
export function nudgeVector(
  key: string,
  mods: { shiftKey: boolean; altKey: boolean },
  grid: number
): [number, number] | null {
  const step = nudgeStep(mods, grid);
  switch (key) {
    case "ArrowLeft":
      return [-step, 0];
    case "ArrowRight":
      return [step, 0];
    case "ArrowUp":
      return [0, -step];
    case "ArrowDown":
      return [0, step];
    default:
      return null;
  }
}

export interface NudgeBurstOptions {
  /** True while a commit is in flight: the burst waits rather than stacking ops. */
  busy: () => boolean;
  /** The one op per burst. Called with the accumulated delta, never with zero. */
  commit: (dx: number, dy: number) => void;
  /** The preview hook: the accumulated delta so far, after every key. */
  onChange: (dx: number, dy: number) => void;
  ms?: number;
  /** The timer, injectable for tests; the window's by default. */
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class NudgeBurst {
  dx = 0;
  dy = 0;
  private timer: unknown = undefined;
  private readonly ms: number;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: NudgeBurstOptions) {
    this.ms = options.ms ?? NUDGE_BURST_MS;
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
  }

  /** A key or a held-key repeat: fold it in and push the deadline out. */
  add(dx: number, dy: number): void {
    this.dx += dx;
    this.dy += dy;
    // Armed before the preview runs: a preview that throws must not leave the
    // delta accumulated and never committed.
    this.arm();
    this.options.onChange(this.dx, this.dy);
  }

  /** Something is accumulated and not yet committed. */
  get pending(): boolean {
    return this.dx !== 0 || this.dy !== 0;
  }

  /** Drop what was accumulated without committing it (Escape, a new layout that made the base stale). */
  cancel(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.dx = 0;
    this.dy = 0;
  }

  private arm(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.fire(), this.ms);
  }

  private fire(): void {
    this.timer = undefined;
    if (!this.pending) return;
    if (this.options.busy()) {
      this.arm();
      return;
    }
    const [dx, dy] = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    this.options.commit(dx, dy);
  }
}
