/**
 * Issue #10: the error.log watcher published the entries that were in the file
 * when the game loaded and then went silent, and clearing the log from the
 * in-game error tracker left the stale Problems behind. Both halves live in the
 * offset/truncation bookkeeping, so these exercise it against real files on
 * disk (the failure was Windows filesystem behavior, not logic in a mock).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LogTail } from "../src/logTail";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-logtail-"));
  file = path.join(dir, "error.log");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Append the way the game does: keep the handle, write, leave it open. */
function withOpenHandle(fn: (append: (text: string) => void) => void): void {
  const fd = fs.openSync(file, "a");
  try {
    fn((text) => {
      fs.writeSync(fd, text);
    });
  } finally {
    fs.closeSync(fd);
  }
}

describe("LogTail", () => {
  it("reads nothing on the first read after seekToEnd", () => {
    fs.writeFileSync(file, "old one\nold two\n");
    const tail = new LogTail(file);
    expect(tail.seekToEnd()).toBe(true);
    expect(tail.read()).toEqual({ lines: [], reset: false, missing: false });
  });

  it("reports a missing file without losing its place", () => {
    const tail = new LogTail(file);
    expect(tail.seekToEnd()).toBe(false);
    expect(tail.read().missing).toBe(true);
    fs.writeFileSync(file, "first\n");
    expect(tail.read().lines).toEqual(["first"]);
  });

  it("picks up appends made through a handle the writer keeps open", () => {
    fs.writeFileSync(file, "before\n");
    const tail = new LogTail(file);
    tail.seekToEnd();
    withOpenHandle((append) => {
      append("during one\n");
      expect(tail.read().lines).toEqual(["during one"]);
      append("during two\n");
      append("during three\n");
      expect(tail.read().lines).toEqual(["during two", "during three"]);
      expect(tail.read().lines).toEqual([]);
    });
  });

  it("holds a partial line back until its newline arrives", () => {
    fs.writeFileSync(file, "");
    const tail = new LogTail(file);
    tail.seekToEnd();
    withOpenHandle((append) => {
      append("[12:00:00][E] half a li");
      expect(tail.read().lines).toEqual([]);
      append("ne\nand a whole one\ntrailing");
      expect(tail.read().lines).toEqual(["[12:00:00][E] half a line", "and a whole one"]);
      append(" bit\n");
      expect(tail.read().lines).toEqual(["trailing bit"]);
    });
  });

  it("keeps multi-byte characters intact when a write straddles two reads", () => {
    fs.writeFileSync(file, "");
    const tail = new LogTail(file);
    tail.seekToEnd();
    const bytes = Buffer.from("Ærik – ünïcode\n", "utf8");
    const fd = fs.openSync(file, "a");
    try {
      // Split mid-sequence: the second byte of the em dash lands in read two.
      fs.writeSync(fd, bytes.subarray(0, 8));
      expect(tail.read().lines).toEqual([]);
      fs.writeSync(fd, bytes.subarray(8));
      expect(tail.read().lines).toEqual(["Ærik – ünïcode"]);
    } finally {
      fs.closeSync(fd);
    }
  });

  it("strips CRLF terminators", () => {
    fs.writeFileSync(file, "");
    const tail = new LogTail(file);
    tail.seekToEnd();
    fs.appendFileSync(file, "one\r\ntwo\r\n");
    expect(tail.read().lines).toEqual(["one", "two"]);
  });

  it("drops a leading BOM so the first entry still parses", () => {
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("first\nsecond\n")]));
    const tail = new LogTail(file);
    expect(tail.read().lines).toEqual(["first", "second"]);
  });

  it("strips a BOM that arrives split across two reads", () => {
    const tail = new LogTail(file);
    expect(tail.seekToEnd()).toBe(false);
    fs.writeFileSync(file, Buffer.from([0xef, 0xbb]));
    expect(tail.read().lines).toEqual([]);
    fs.appendFileSync(file, Buffer.concat([Buffer.from([0xbf]), Buffer.from("first\n")]));
    expect(tail.read().lines).toEqual(["first"]);
  });

  it("signals reset and rereads from zero when the log is truncated in place", () => {
    fs.writeFileSync(file, "");
    const tail = new LogTail(file);
    tail.seekToEnd();
    fs.appendFileSync(file, "stale one\nstale two\n");
    expect(tail.read().lines).toEqual(["stale one", "stale two"]);

    // What the in-game error tracker's right-click "clear" does.
    fs.truncateSync(file, 0);
    expect(tail.read()).toEqual({ lines: [], reset: true, missing: false });

    fs.appendFileSync(file, "fresh\n");
    expect(tail.read()).toEqual({ lines: ["fresh"], reset: false, missing: false });
  });

  it("reports the truncation and the lines that followed it in one read", () => {
    fs.writeFileSync(file, "");
    const tail = new LogTail(file);
    tail.seekToEnd();
    fs.appendFileSync(file, "a long stale entry that outweighs what follows\n");
    tail.read();
    fs.truncateSync(file, 0);
    fs.appendFileSync(file, "fresh\n");
    expect(tail.read()).toEqual({ lines: ["fresh"], reset: true, missing: false });
  });

  it("signals reset when the file is replaced rather than truncated", () => {
    fs.writeFileSync(file, "");
    const tail = new LogTail(file);
    tail.seekToEnd();
    fs.appendFileSync(file, "session one\n");
    expect(tail.read().lines).toEqual(["session one"]);

    // A relaunch deletes error.log and creates a new one at the same path. The
    // replacement is longer than the old offset, so only the changed file index
    // gives it away. POSIX may hand the freed inode straight back, and then
    // there is no signal at all: assert against what the filesystem actually
    // did rather than against the platform we happen to run on. See the KNOWN
    // GAP note in logTail.ts.
    const before = fs.statSync(file);
    fs.rmSync(file);
    fs.writeFileSync(file, "session two, and a longer first line than before\n");
    const identityChanged = Number(before.ino) !== Number(fs.statSync(file).ino);

    const after = tail.read();
    expect(after.reset).toBe(identityChanged);
    if (identityChanged) {
      expect(after.lines).toEqual(["session two, and a longer first line than before"]);
    }
  });

  it("discards a half-written line when the log is cleared under it", () => {
    fs.writeFileSync(file, "");
    const tail = new LogTail(file);
    tail.seekToEnd();
    fs.appendFileSync(file, "unterminated");
    expect(tail.read().lines).toEqual([]);
    fs.truncateSync(file, 0);
    fs.appendFileSync(file, "fresh\n");
    const after = tail.read();
    expect(after.reset).toBe(true);
    expect(after.lines).toEqual(["fresh"]);
  });

  it("survives an append larger than one read chunk", () => {
    fs.writeFileSync(file, "");
    const tail = new LogTail(file);
    tail.seekToEnd();
    const many = Array.from({ length: 20000 }, (_, i) => `entry ${i} padding padding padding`);
    fs.appendFileSync(file, many.join("\n") + "\n");
    const got = tail.read();
    expect(got.lines.length).toBe(many.length);
    expect(got.lines[0]).toBe(many[0]);
    expect(got.lines.at(-1)).toBe(many.at(-1));
  });
});
