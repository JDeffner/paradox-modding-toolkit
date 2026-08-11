/**
 * Tailing a log file that another process (the game) holds open and appends to.
 * No vscode imports: the offset/truncation bookkeeping is the part that has to
 * be right, so it stays unit-testable in plain Node.
 *
 * The Windows constraints this is built around, in the order they bite:
 *
 * - `fs.readSync` can hand back fewer bytes than a preceding `fs.statSync`
 *   promised while the writer's last append is still settling. Advancing the
 *   offset by the stat size instead of by the bytes actually read skips that
 *   region for good, and the entries in it are never published. So the offset
 *   only ever moves by `bytesRead`, and the size is never used to locate data.
 * - For the same reason a stat that says "unchanged" is not proof that nothing
 *   was appended, which is why every poll opens the file and reads to EOF
 *   rather than short-circuiting on size/mtime. One open of a small file per
 *   second costs nothing next to missing the entries the watcher exists for.
 * - The in-game error tracker's "clear log" and a game relaunch both replace
 *   the file. The size shrinks, or the NTFS file index changes under the same
 *   path; either way everything published so far describes a log that is gone,
 *   so the read reports `reset` and the caller drops its diagnostics.
 *
 *   POSIX needs one more thing before `ino` can carry that: the kernel hands
 *   back the inode it just freed, so a delete-then-recreate lands on the same
 *   number. A replacement SHORTER than the old offset still trips the shrink
 *   test, but a longer one would be invisible and the next read would continue
 *   into the middle of a file it never saw the start of. So on POSIX the
 *   descriptor the last read came from stays open: an inode with a live
 *   descriptor cannot be reused, which makes the recorded number matchable only
 *   by the same file, and any new error.log at that path reads as a replacement.
 *   The pin is POSIX-only. On Windows it buys nothing, because the file index is
 *   already fresh per file, and holding a handle on a file the game deletes and
 *   recreates is risk for no return: a deleted name can stay delete-pending
 *   until the last handle closes, and then the game fails to create its next
 *   error.log. That did not reproduce on Win10 19045 (the unlink and the
 *   recreate both went through with our handle open), but it turns on the build,
 *   the filesystem and how the deleter opens the file, so it is not something to
 *   stand on for nothing. The pin is also why `close()` exists, and why
 *   `ErrorLogWatcher.stop()` has to call it.
 *
 *   `birthtimeMs` looks like the cheap answer and is NOT one: where the kernel
 *   has no statx, libuv fills birthtime from ctime, which moves on every append,
 *   so it reports a reset on every poll and drops diagnostics continuously.
 * - Appends land mid-line and multi-byte UTF-8 sequences straddle reads, so the
 *   trailing partial line and the decoder state carry over to the next read.
 */
import * as fs from "fs";
import { StringDecoder } from "string_decoder";

const CHUNK_BYTES = 256 * 1024;
/** See the inode note in the header: POSIX needs the pin, Windows has no use
 *  for it and would only be taking on a handle it cannot benefit from. */
const PIN_INODE = process.platform !== "win32";

export interface TailRead {
  /** Complete lines appended since the previous read, terminators stripped. */
  lines: string[];
  /** The file was truncated or replaced: anything published earlier is stale. */
  reset: boolean;
  /** The file could not be read this round (not created yet, or locked). */
  missing: boolean;
}

export class LogTail {
  private offset = 0;
  private ino = 0;
  private pending = "";
  private decoder = new StringDecoder("utf8");
  /** A BOM is still owed a strip: reading from offset 0, no text decoded yet. */
  private stripBom = true;
  /** POSIX: an open descriptor to the file `ino` came from, so it stays ours. */
  private pin: number | null = null;

  constructor(readonly file: string) {}

  /**
   * Take over `fd` as the pin, or just close it where pinning is wrong. Called
   * for every descriptor whose `ino` was recorded, so exactly one is ever held.
   */
  private retain(fd: number): void {
    if (!PIN_INODE) {
      fs.closeSync(fd);
      return;
    }
    const previous = this.pin;
    this.pin = fd;
    if (previous !== null) fs.closeSync(previous);
  }

  /**
   * Drop the pinned descriptor. Reading afterwards is fine (the next read pins
   * again), but the watcher has to call this when it stops, or the descriptor
   * outlives the watch and, once the game deletes the log, keeps a file nobody
   * can see from returning its blocks.
   */
  close(): void {
    const fd = this.pin;
    this.pin = null;
    if (fd !== null) fs.closeSync(fd);
  }

  /**
   * Ignore whatever is already in the file: only entries from now on matter.
   * Returns false when the file does not exist yet (the game has not run).
   *
   * A read-open can fail with a sharing violation where a stat succeeds (the
   * game or an AV scanner holding the file); falling back to the stat size
   * matters, because an offset left at 0 here would make the first successful
   * read publish the ENTIRE pre-existing log as this session's new entries,
   * which is the exact issue-#10 symptom this class exists to remove.
   */
  seekToEnd(): boolean {
    this.offset = 0;
    this.ino = 0;
    this.pending = "";
    this.decoder = new StringDecoder("utf8");
    this.stripBom = true;
    this.close();
    let fd: number;
    try {
      fd = fs.openSync(this.file, "r");
    } catch {
      try {
        // No descriptor, so no pin either: this branch is a Windows sharing
        // violation, and Windows does not need one.
        const st = fs.statSync(this.file);
        this.offset = st.size;
        this.ino = Number(st.ino) || 0;
        this.stripBom = false;
        return true;
      } catch {
        return false; // no file at all: the first read starts from 0
      }
    }
    try {
      const st = fs.fstatSync(fd);
      this.offset = st.size;
      this.ino = Number(st.ino) || 0;
      if (st.size > 0) this.stripBom = false;
      return true;
    } finally {
      this.retain(fd);
    }
  }

  read(): TailRead {
    let fd: number;
    try {
      fd = fs.openSync(this.file, "r");
    } catch {
      return { lines: [], reset: false, missing: true };
    }
    let st: fs.Stats;
    try {
      st = fs.fstatSync(fd);
    } catch {
      // Nothing mutated yet, so "missing" is still the honest answer here. The
      // pin stays on the file the recorded ino came from, which is the point:
      // it has to outlive a poll that saw nothing.
      fs.closeSync(fd);
      return { lines: [], reset: false, missing: true };
    }
    try {
      const ino = Number(st.ino) || 0;
      // ino is 0 on filesystems that do not report a file index; there the
      // shrink test is the only replacement signal available.
      const replaced = ino !== 0 && this.ino !== 0 && ino !== this.ino;
      const reset = st.size < this.offset || replaced;
      if (reset) {
        this.offset = 0;
        this.pending = "";
        this.decoder = new StringDecoder("utf8");
        this.stripBom = true;
      }
      this.ino = ino;

      let text = this.pending;
      this.pending = "";
      const buf = Buffer.allocUnsafe(CHUNK_BYTES);
      try {
        for (;;) {
          const n = fs.readSync(fd, buf, 0, buf.length, this.offset);
          if (n <= 0) break;
          this.offset += n;
          text += this.decoder.write(buf.subarray(0, n));
        }
      } catch {
        // A mid-loop failure keeps what was already consumed: the offset only
        // ever advanced by bytes actually read, so the rest arrives next poll.
        // Swallowing it into "missing" here would discard decoded text the
        // offset has moved past, and bury a reset the caller must act on.
      }
      if (this.stripBom && text.length > 0) {
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        this.stripBom = false;
      }

      const parts = text.split("\n");
      this.pending = parts.pop() ?? "";
      return {
        lines: parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)),
        reset,
        missing: false,
      };
    } finally {
      this.retain(fd);
    }
  }
}
