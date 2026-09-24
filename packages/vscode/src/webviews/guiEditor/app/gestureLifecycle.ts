/**
 * Owns one pointer gesture. Release consumes it before committing, cancellation
 * only cleans its preview, and late asynchronous verdicts cannot revive it.
 * Geometry, guard decisions and host messages remain with the caller.
 */
export class GestureLifecycle<T> {
  private active: T | null = null;

  constructor(
    private readonly actions: {
      commit: (gesture: T) => void;
      cancel: (gesture: T) => void;
    }
  ) {}

  get current(): T | null {
    return this.active;
  }

  begin(gesture: T): void {
    this.cancel();
    this.active = gesture;
  }

  owns(gesture: unknown): boolean {
    return this.active === gesture;
  }

  update(gesture: T, update: (gesture: T) => void): void {
    if (this.owns(gesture)) update(gesture);
  }

  commit(): void {
    const gesture = this.take();
    if (gesture !== null) this.actions.commit(gesture);
  }

  cancel(): void {
    const gesture = this.take();
    if (gesture !== null) this.actions.cancel(gesture);
  }

  private take(): T | null {
    const gesture = this.active;
    this.active = null;
    return gesture;
  }
}
