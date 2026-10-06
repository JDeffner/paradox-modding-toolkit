import { EventEmitter } from "events";
import { beforeEach, expect, it, vi } from "vitest";

const workers = vi.hoisted(() => ({ create: vi.fn(), exists: vi.fn() }));
vi.mock("worker_threads", () => ({
  Worker: class {
    constructor() {
      return workers.create();
    }
  },
}));
vi.mock("fs", () => ({ existsSync: workers.exists }));

class TestWorker extends EventEmitter {
  postMessage = vi.fn();
  unref = vi.fn();
  terminate = vi.fn(async () => 0);

  complete(size: number): void {
    const [{ id }] = this.postMessage.mock.lastCall!;
    this.emit("message", { id, size });
  }
}

beforeEach(() => {
  vi.resetModules();
  workers.create.mockReset();
  workers.exists.mockReturnValue(true);
});

it("settles the first decode and later calls when worker construction fails", async () => {
  workers.create.mockImplementation(() => {
    throw new Error("worker startup failed");
  });
  const { decodeOffThread, decodePoolAvailable } = await import("../src/webviews/guiEditor/decodePool");
  await expect(decodeOffThread("a", 128, "out-a")).resolves.toBeNull();
  expect(decodePoolAvailable()).toBe(false);
  await expect(decodeOffThread("b", 128, "out-b")).resolves.toBeNull();
  expect(workers.create).toHaveBeenCalledOnce();
});

it("keeps queued jobs on an existing worker when creating another fails", async () => {
  const worker = new TestWorker();
  workers.create.mockReturnValueOnce(worker).mockImplementation(() => {
    throw new Error("no more threads");
  });
  const { decodeOffThread } = await import("../src/webviews/guiEditor/decodePool");
  const first = decodeOffThread("a", 128, "out-a");
  const queued = decodeOffThread("b", 128, "out-b");
  worker.complete(10);
  worker.complete(20);
  await expect(Promise.all([first, queued])).resolves.toEqual([10, 20]);
});

it("settles running and queued jobs when the last worker dies after startup was disabled", async () => {
  const worker = new TestWorker();
  workers.create.mockReturnValueOnce(worker).mockImplementation(() => {
    throw new Error("no more threads");
  });
  const { decodeOffThread } = await import("../src/webviews/guiEditor/decodePool");
  const first = decodeOffThread("a", 128, "out-a");
  const queued = decodeOffThread("b", 128, "out-b");
  worker.emit("error", new Error("worker died"));
  worker.emit("exit", 1);
  worker.complete(99);
  await expect(Promise.all([first, queued])).resolves.toEqual([null, null]);
});

it("ignores duplicate failure and late replies while a replacement drains the queue", async () => {
  const pool = Array.from({ length: 4 }, () => new TestWorker());
  const replacement = new TestWorker();
  for (const worker of [...pool, replacement]) workers.create.mockReturnValueOnce(worker);
  const { decodeOffThread } = await import("../src/webviews/guiEditor/decodePool");
  const jobs = Array.from({ length: 6 }, (_, i) => decodeOffThread(String(i), 128, `out-${i}`));
  pool[0].emit("error", new Error("worker died"));
  pool[0].emit("exit", 1);
  pool[0].complete(99);
  expect(workers.create).toHaveBeenCalledTimes(5);
  replacement.complete(40);
  replacement.complete(50);
  pool.slice(1).forEach((worker, i) => worker.complete((i + 1) * 10));
  await expect(Promise.all(jobs)).resolves.toEqual([null, 10, 20, 30, 40, 50]);
});

it("settles a postMessage failure and accepts later work on a replacement", async () => {
  const failed = new TestWorker();
  failed.postMessage.mockImplementation(() => {
    throw new Error("cannot post job");
  });
  const replacement = new TestWorker();
  workers.create.mockReturnValueOnce(failed).mockReturnValueOnce(replacement);
  const { decodeOffThread } = await import("../src/webviews/guiEditor/decodePool");
  await expect(decodeOffThread("a", 128, "out-a")).resolves.toBeNull();
  expect(failed.terminate).toHaveBeenCalledOnce();
  const next = decodeOffThread("b", 128, "out-b");
  failed.emit("exit", 1);
  replacement.complete(20);
  await expect(next).resolves.toBe(20);
});
