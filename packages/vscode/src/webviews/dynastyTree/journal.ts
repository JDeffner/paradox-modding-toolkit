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
}

export interface JournalIo {
  /** The file's current text, or null when it cannot be read. */
  read(file: string): Promise<string | null>;
  /** Replace the whole file with `text` and save it. */
  write(file: string, text: string): Promise<boolean>;
  /** Say why nothing was written. */
  refuse(message: string): void;
}

/** How many writes back a panel can go. Beyond this the oldest one is dropped. */
const DEFAULT_CAP = 50;

export class WriteJournal {
  private readonly done: JournalWrite[] = [];
  private readonly undone: JournalWrite[] = [];

  constructor(
    private readonly io: JournalIo,
    private readonly cap: number = DEFAULT_CAP
  ) {}

  /** One write the panel just made. A new write ends the redo line. */
  record(write: JournalWrite): void {
    this.undone.length = 0;
    this.done.push(write);
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
   * (`have`). A refused step KEEPS its entry: the panel has not undone
   * anything, and saying so is more use than quietly forgetting the write.
   */
  private async step(
    from: JournalWrite[],
    to: JournalWrite[],
    want: "before" | "after",
    have: "after" | "before"
  ): Promise<boolean> {
    const entry = from[from.length - 1];
    if (!entry) return false;
    const now = await this.io.read(entry.file);
    const name = path.basename(entry.file);
    if (now === null) {
      this.io.refuse(`${name} cannot be read, so nothing was changed.`);
      return false;
    }
    if (now !== entry[have]) {
      this.io.refuse(`${name} has changed since the panel wrote it, so nothing was changed.`);
      return false;
    }
    if (!(await this.io.write(entry.file, entry[want]))) return false;
    from.pop();
    to.push(entry);
    return true;
  }
}
