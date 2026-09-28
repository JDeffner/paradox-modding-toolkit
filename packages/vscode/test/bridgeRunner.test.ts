import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "child_process";
import { BridgeStartError, BridgeWaitError, runBridgeProcess } from "../src/steam/bridgeRunner";
import type { BridgeJob } from "../src/steam/jobs";

vi.mock("child_process", () => ({ spawn: vi.fn() }));

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  // Deliberately never emits close, even after kill.
  kill = vi.fn(() => true);
  progress(status = "Uploading content", uploaded = 0, submit = 1, total = 100): void {
    this.event({ type: "progress", status, uploaded, total, submit, submits: 2 });
  }
  event(event: object): void {
    this.stdout.emit("data", Buffer.from(JSON.stringify(event) + "\n"));
  }
}

const MINUTE = 60_000;
const publish: BridgeJob = { action: "publish", appId: 1, itemId: "123", submits: [{}, {}] };
let child: FakeChild;

function start(job: BridgeJob = publish, signal?: AbortSignal) {
  const success = vi.fn();
  const failure = vi.fn();
  const promise = runBridgeProcess("bridge.js", "steamwand", job, vi.fn(), undefined, signal).then(
    success,
    failure
  );
  return { success, failure, promise };
}

beforeEach(() => {
  vi.useFakeTimers();
  child = new FakeChild();
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
});
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Steam bridge watchdog", () => {
  it.each([false, true, undefined])(
    "preserves certainty that an operation started (%s)",
    async (operationStarted) => {
      const task = start();
      child.event({ type: "error", message: "Steam unavailable", operationStarted });
      await task.promise;
      expect(task.failure.mock.calls[0][0] instanceof BridgeStartError).toBe(operationStarted === false);
      expect(spawn).toHaveBeenCalledOnce();
    }
  );

  it("classifies a synchronous spawn exception as not started", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error("invalid executable");
    });
    const task = start();
    await task.promise;
    expect(task.failure.mock.calls[0][0]).toBeInstanceOf(BridgeStartError);
  });

  it("settles a silent child without waiting for close and does not replay the upload", async () => {
    const task = start();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    await task.promise;
    expect(task.failure.mock.calls[0][0]).toMatchObject({ reason: "silent", remoteMayHaveChanged: true });
    expect(task.failure.mock.calls[0][0].message).toContain("Refresh the Workshop item");
    expect(child.kill).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("does not mistake repeated progress or changing totals for forward progress", async () => {
    const task = start();
    child.progress();
    for (let i = 0; i < 600; i++) {
      child.progress("Uploading content", 0, 1, 100 + i);
      await vi.advanceTimersByTimeAsync(500);
    }
    await task.promise;
    expect(task.failure.mock.calls[0][0]).toMatchObject({ reason: "stalled" });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("does not mistake stderr chatter for forward progress", async () => {
    const task = start();
    child.progress();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(MINUTE - 1);
      child.stderr.emit("data", Buffer.from("still waiting\n"));
    }
    await vi.advanceTimersByTimeAsync(5);
    await task.promise;
    expect(task.failure.mock.calls[0][0]).toMatchObject({ reason: "stalled" });
  });

  it("allows moving bytes, new phases and new submissions", async () => {
    const task = start();
    child.progress();
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    child.progress("Uploading content", 30);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    child.progress("Uploading preview image", 0);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    child.progress("Waiting for Steam", 0, 2);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    child.event({
      type: "done",
      result: { action: "publish", itemId: "123", needsToAcceptAgreement: false },
    });
    await task.promise;
    expect(task.failure).not.toHaveBeenCalled();
    expect(task.success).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.each(["Preparing configuration", "Preparing content", "Committing changes"])(
    "allows slow %s but still bounds it",
    async (status) => {
      const task = start();
      child.progress(status);
      for (let i = 0; i < 14; i++) {
        await vi.advanceTimersByTimeAsync(MINUTE);
        child.progress(status);
      }
      expect(task.failure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(MINUTE);
      await task.promise;
      expect(task.failure.mock.calls[0][0]).toMatchObject({ reason: "stalled" });
    }
  );

  it("does not count regressing counters or phase oscillation as progress", async () => {
    const task = start();
    child.progress("Uploading preview image", 50);
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(MINUTE);
      child.progress("Uploading content", 90);
      child.progress("Uploading preview image", 40);
      child.progress("Uploading preview image", 50);
    }
    await vi.advanceTimersByTimeAsync(MINUTE);
    await task.promise;
    expect(task.failure.mock.calls[0][0]).toMatchObject({ reason: "stalled" });
  });

  it("stops waiting immediately and ignores later output", async () => {
    const controller = new AbortController();
    const task = start(publish, controller.signal);
    controller.abort();
    child.progress();
    child.event({ type: "done", result: { action: "publish" } });
    await task.promise;
    expect(task.failure.mock.calls[0][0]).toBeInstanceOf(BridgeWaitError);
    expect(task.failure.mock.calls[0][0]).toMatchObject({ reason: "stopped", remoteMayHaveChanged: true });
    expect(task.success).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("does not start a job when the wait was already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const task = start(publish, controller.signal);
    await task.promise;
    expect(spawn).not.toHaveBeenCalled();
    expect(task.failure.mock.calls[0][0]).toMatchObject({ remoteMayHaveChanged: false });
  });

  it("distinguishes read timeouts from uncertain remote mutations", async () => {
    const task = start({ action: "query", appId: 1, itemId: "123" });
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    await task.promise;
    expect(task.failure.mock.calls[0][0]).toMatchObject({ remoteMayHaveChanged: false });
    expect(task.failure.mock.calls[0][0].message).toContain("Refresh to try the read again");
  });

  it.each(["error", "close", "spawn", "stdin"])("clears all timers after %s", async (source) => {
    const task = start();
    if (source === "error") child.event({ type: "error", message: "Steam rejected the update" });
    if (source === "close") child.emit("close", 1);
    if (source === "spawn") child.emit("error", new Error("spawn failed"));
    if (source === "stdin") child.stdin.emit("error", new Error("pipe closed"));
    await task.promise;
    expect(task.failure).toHaveBeenCalledOnce();
    expect(task.failure.mock.calls[0][0]).not.toBeInstanceOf(BridgeWaitError);
    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    expect(task.failure).toHaveBeenCalledOnce();
  });
});
