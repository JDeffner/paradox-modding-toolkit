import { parseLoc, type LocEntry, type LocParseResult } from "./locParser";
import type { Range } from "./cst";

/** Reparse a changed localization line; header and multiline edits use the full parser. */
export class IncrementalLoc {
  text = "";
  result!: LocParseResult;
  lines: string[] = [];
  starts: number[] = [];

  constructor(text: string) {
    this.reset(text);
  }

  reset(text: string): LocParseResult {
    this.text = text;
    this.result = parseLoc(text);
    this.lines = text.split(/(?<=\n)|(?<=\r)(?!\n)/);
    if (/[\r\n]$/.test(text)) this.lines.push("");
    let offset = 0;
    this.starts = this.lines.map((line) => {
      const start = offset;
      offset += line.length;
      return start;
    });
    return this.result;
  }

  edit(line: number, character: number, remove: number, insert: string): LocParseResult {
    const start = this.starts[line];
    const at = start + character;
    const next = this.text.slice(0, at) + insert + this.text.slice(at + remove);
    const old = this.result;
    if (
      !old.headerRange ||
      start <= old.headerRange.end ||
      /[\r\n]/.test(insert) ||
      at + remove > start + this.lines[line].replace(/[\r\n]+$/, "").length
    )
      return this.reset(next);

    const delta = insert.length - remove;
    const end = start + this.lines[line].length;
    const updatedLine =
      this.lines[line].slice(0, character) + insert + this.lines[line].slice(character + remove);
    const prefix = `l_${old.language}:\n`;
    const part = parseLoc(prefix + updatedLine);
    const range = (value: Range, shift: number): Range => ({
      start: value.start + shift,
      end: value.end + shift,
    });
    const entry = (value: LocEntry, shift: number, lineNumber: number): LocEntry => ({
      ...value,
      line: lineNumber,
      keyRange: range(value.keyRange, shift),
      valueRange: range(value.valueRange, shift),
    });
    const entries: LocEntry[] = [];
    for (const value of old.entries) if (value.line < line) entries.push(value);
    for (const value of part.entries) entries.push(entry(value, start - prefix.length, line));
    for (const value of old.entries)
      if (value.line > line) entries.push(delta ? entry(value, delta, value.line) : value);
    const errors = [];
    for (const value of old.errors) if (value.range.start < start) errors.push(value);
    for (const value of part.errors)
      errors.push({ ...value, range: range(value.range, start - prefix.length) });
    // An error at EOF belongs to the edited final line, even when that line was empty.
    for (const value of old.errors)
      if (value.range.start >= end && end < this.text.length)
        errors.push(delta ? { ...value, range: range(value.range, delta) } : value);
    this.text = next;
    this.lines[line] = updatedLine;
    for (let i = line + 1; i < this.starts.length; i++) this.starts[i] += delta;
    this.result = { ...old, entries, errors };
    return this.result;
  }
}
