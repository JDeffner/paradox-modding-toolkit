/**
 * The Dynasty Tree's undo. The rule worth a test is the refusal: a file that
 * somebody else has changed since the panel wrote it must NOT be put back,
 * because the panel's `before` would throw that work away.
 */
import { describe, expect, it } from "vitest";
import { WriteJournal, type JournalIo } from "../src/webviews/dynastyTree/journal";

function fakeIo(files: Record<string, string>): JournalIo & { refusals: string[] } {
  const refusals: string[] = [];
  return {
    refusals,
    read: (file) => Promise.resolve(files[file] ?? null),
    write: (file, text) => {
      files[file] = text;
      return Promise.resolve(true);
    },
    refuse: (message) => void refusals.push(message),
  };
}

describe("WriteJournal", () => {
  it("puts the file back and then writes it again", async () => {
    const files = { "/mod/a.txt": "after" };
    const io = fakeIo(files);
    const journal = new WriteJournal(io);
    journal.record({ file: "/mod/a.txt", before: "before", after: "after" });
    expect(journal.depth).toEqual({ undo: 1, redo: 0 });

    expect(await journal.undo()).toBe(true);
    expect(files["/mod/a.txt"]).toBe("before");
    expect(journal.depth).toEqual({ undo: 0, redo: 1 });

    expect(await journal.redo()).toBe(true);
    expect(files["/mod/a.txt"]).toBe("after");
    expect(journal.depth).toEqual({ undo: 1, redo: 0 });
  });

  it("refuses when the file changed since the panel wrote it", async () => {
    const files = { "/mod/a.txt": "somebody else edited this" };
    const io = fakeIo(files);
    const journal = new WriteJournal(io);
    journal.record({ file: "/mod/a.txt", before: "before", after: "after" });

    expect(await journal.undo()).toBe(false);
    expect(files["/mod/a.txt"]).toBe("somebody else edited this");
    expect(io.refusals[0]).toContain("a.txt");
    // The entry stays: nothing was undone, and the panel says so rather than
    // quietly forgetting the write.
    expect(journal.depth).toEqual({ undo: 1, redo: 0 });
  });

  it("refuses when the file cannot be read", async () => {
    const io = fakeIo({});
    const journal = new WriteJournal(io);
    journal.record({ file: "/mod/gone.txt", before: "before", after: "after" });
    expect(await journal.undo()).toBe(false);
    expect(io.refusals[0]).toContain("gone.txt");
  });

  it("does nothing when there is nothing to undo or redo", async () => {
    const journal = new WriteJournal(fakeIo({}));
    expect(await journal.undo()).toBe(false);
    expect(await journal.redo()).toBe(false);
  });

  it("ends the redo line at the next write", async () => {
    const files = { "/mod/a.txt": "after" };
    const journal = new WriteJournal(fakeIo(files));
    journal.record({ file: "/mod/a.txt", before: "before", after: "after" });
    await journal.undo();
    journal.record({ file: "/mod/a.txt", before: "before", after: "other" });
    expect(journal.depth).toEqual({ undo: 1, redo: 0 });
  });

  it("keeps only the last writes of a long session", async () => {
    const journal = new WriteJournal(fakeIo({}), 2);
    for (const n of [1, 2, 3]) {
      journal.record({ file: `/mod/${n}.txt`, before: "b", after: "a" });
    }
    expect(journal.depth).toEqual({ undo: 2, redo: 0 });
  });
});
