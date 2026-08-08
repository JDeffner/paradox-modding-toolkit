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
 * - Appends land mid-line and multi-byte UTF-8 sequences straddle reads, so the
 *   trailing partial line and the decoder state carry over to the next read.
 */
import * as fs from "fs";
import { StringDecoder } from "string_decoder";

const CHUNK_BYTES = 256 * 1024;

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

  constructor(readonly file: string) {}

  /**
   * Ignore whatever is already in the file: only entries from now on matter.
   * Returns false when the file does not exist yet (the game has not run).
   */
  seekToEnd(): boolean {
    this.offset = 0;
    this.ino = 0;
    this.pending = "";
    this.decoder = new StringDecoder("utf8");
    let fd: number;
    try {
      fd = fs.openSync(this.file, "r");
    } catch {
      return false; // the first read starts from 0 once the game writes it
    }
    try {
      const st = fs.fstatSync(fd);
      this.offset = st.size;
      this.ino = Number(st.ino) || 0;
      return true;
    } finally {
      fs.closeSync(fd);
    }
  }

  read(): TailRead {
    let fd: number;
    try {
      fd = fs.openSync(this.file, "r");
    } catch {
      return { lines: [], reset: false, missing: true };
    }
    try {
      const st = fs.fstatSync(fd);
      const ino = Number(st.ino) || 0;
      // ino is 0 on filesystems that do not report a file index; there the
      // shrink test is the only replacement signal available.
      const replaced = ino !== 0 && this.ino !== 0 && ino !== this.ino;
      const reset = st.size < this.offset || replaced;
      if (reset) {
        this.offset = 0;
        this.pending = "";
        this.decoder = new StringDecoder("utf8");
      }
      this.ino = ino;

      const startedAtZero = this.offset === 0;
      let text = this.pending;
      const buf = Buffer.allocUnsafe(CHUNK_BYTES);
      for (;;) {
        const n = fs.readSync(fd, buf, 0, buf.length, this.offset);
        if (n <= 0) break;
        this.offset += n;
        text += this.decoder.write(buf.subarray(0, n));
      }
      if (startedAtZero && text.charCodeAt(0) === 0xfeff) text = text.slice(1);

      const parts = text.split("\n");
      this.pending = parts.pop() ?? "";
      return {
        lines: parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)),
        reset,
        missing: false,
      };
    } catch {
      return { lines: [], reset: false, missing: true };
    } finally {
      fs.closeSync(fd);
    }
  }
}
