/**
 * Undo for a panel that writes files.
 *
 * Every write the Dynasty Tree makes goes through here as `{ file, before,
 * after }`, and undo puts `before` back. The rule that makes that safe is the
 * one the creators' `applyDefinitionEdits` already follows: a file whose text
 * is no longer what the panel left there was changed by somebody else, so
 * nothing is written and the modder is told which file it was. The panel never
 * wins an argument with the editor.
 *
 * The journal is session-only, capped, and holds whole file texts because that
 * is what can be put back without re-deriving anything: a loc write is a
 * line rewritten by the loc writer, a script write is a server-computed edit
 * set, and no single model covers both.
 *
 * No `vscode` imports: unit-tested in plain Node (test/dynastyJournal.test.ts).
 */
import * as path from "path";

export interface JournalWrite {
  file: string;
  /** The file's text before the panel wrote it. */
  before: string;
  /** The file's text the panel left behind. */
  after: string;
  /** Bytes left by the saved write, independent of the editor's text. */
  disk?: Buffer;
}

export interface JournalState {
  text: string;
  /** Diskless journal clients can supply editor text alone. */
  disk?: Buffer;
}

export interface JournalIo {
  /** Current editor text and disk bytes, or null when they cannot be read. */
  read(file: string): Promise<string | JournalState | null>;
  /** Replace the whole file with `text` and save it. */
  write(file: string, text: string, expected: JournalState): Promise<boolean>;
  /** Report a stale input or a failed history save, including partial progress. */
  refuse(message: string): void;
}

/** How many gestures back a panel can go. Beyond this the oldest one is dropped. */
const DEFAULT_CAP = 50;

/**
 * One gesture as the modder made it: a new dynasty is a block AND a loc line,
 * two files, one undo. Writes of a gesture are put back last-first.
 */
interface Gesture {
  writes: JournalWrite[];
  /** Editor text and disk bytes expected by the next history step, including interrupted saves. */
  current: Map<JournalWrite, JournalState>;
}

export class WriteJournal {
  private readonly done: Gesture[] = [];
  private readonly undone: Gesture[] = [];

  constructor(
    private readonly io: JournalIo,
    private readonly cap: number = DEFAULT_CAP
  ) {}

  /**
   * One write the panel just made. A new gesture ends the redo line; `join`
   * adds the write to the gesture before it (the loc line a block save also
   * writes), so the two go back together.
   */
  record(write: JournalWrite, join = false): void {
    this.undone.length = 0;
    const last = this.done[this.done.length - 1];
    if (join && last) {
      last.writes.push(write);
      last.current.set(write, { text: write.after, disk: write.disk });
      return;
    }
    this.done.push({ writes: [write], current: new Map([[write, { text: write.after, disk: write.disk }]]) });
    if (this.done.length > this.cap) this.done.shift();
  }

  /** What the toolbar's two buttons should be able to do. */
  get depth(): { undo: number; redo: number } {
    return { undo: this.done.length, redo: this.undone.length };
  }

  undo(): Promise<boolean> {
    return this.step(this.done, this.undone, "before", "after");
  }

  redo(): Promise<boolean> {
    return this.step(this.undone, this.done, "after", "before");
  }

  /**
   * Put `want` back, but only over the text this journal itself left there
   * (`have`). Every file of the gesture is checked before any is written, so a
   * stale gesture is refused before any write. Failed saves retain the text
   * already restored by this step, allowing a retry without overwriting edits
   * made after the failure.
   */
  private async step(
    from: Gesture[],
    to: Gesture[],
    want: "before" | "after",
    have: "after" | "before"
  ): Promise<boolean> {
    const gesture = from[from.length - 1];
    if (!gesture) return false;
    for (const entry of gesture.writes) {
      const value = await this.io.read(entry.file);
      const now = typeof value === "string" ? { text: value } : value;
      const name = path.basename(entry.file);
      if (now === null) {
        this.io.refuse(`${name} cannot be read, so this history step cannot continue.`);
        return false;
      }
      const expected = gesture.current.get(entry) ?? { text: entry[have] };
      if (now.text !== expected.text || (expected.disk && !now.disk?.equals(expected.disk))) {
        this.io.refuse(`${name} has changed since the panel wrote it, so this history step cannot continue.`);
        return false;
      }
      gesture.current.set(entry, now);
    }
    for (const entry of [...gesture.writes].reverse()) {
      let saved = false;
      let failure = "";
      const expected = gesture.current.get(entry)!;
      try {
        saved = await this.io.write(entry.file, entry[want], expected);
      } catch (error) {
        failure = ` ${String(error)}`;
      }
      if (!saved) {
        // A rejected save can still leave our replacement in the editor buffer.
        const value = await this.io.read(entry.file);
        const now = typeof value === "string" ? { text: value } : value;
        if (now?.text === entry[want]) gesture.current.set(entry, { text: entry[want], disk: expected.disk });
        const restored = gesture.writes
          .filter((write) => write !== entry && gesture.current.get(write)?.text === write[want])
          .map((write) => path.basename(write.file));
        this.io.refuse(
          `${path.basename(entry.file)} could not be saved.${failure}` +
            (restored.length ? ` Earlier files restored: ${restored.join(", ")}.` : "") +
            " Retry this history step to finish."
        );
        return false;
      }
      const value = await this.io.read(entry.file);
      const now = typeof value === "string" ? { text: value } : value;
      if (!now || now.text !== entry[want]) {
        this.io.refuse(
          `${path.basename(entry.file)} changed during the history step. Retry after restoring its saved text.`
        );
        return false;
      }
      gesture.current.set(entry, now);
    }
    from.pop();
    to.push(gesture);
    return true;
  }
}
