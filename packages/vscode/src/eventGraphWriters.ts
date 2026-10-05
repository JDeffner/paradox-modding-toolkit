import * as fs from "node:fs";
import { parseScript } from "@px-lsp/server/parser";
import { readDocument, writeDocument, type DocumentSnapshot } from "./documentWrite";

const bodyText = (text: string): string => text.replace(/^\uFEFF/, "");
const eolFor = (text: string): string => (text.includes("\r\n") ? "\r\n" : "\n");

function namespaceFor(id: string): string {
  if (!/^[A-Za-z0-9_-]+\.\d+$/.test(id)) throw new Error("Use an event id in namespace.number format");
  return id.slice(0, id.indexOf("."));
}

function checkedCount(count: number, max: number): void {
  if (!Number.isInteger(count) || count < 0 || count > max)
    throw new Error(`Option count must be an integer from 0 to ${max}`);
}

function parsedFile(text: string) {
  const parsed = parseScript(text);
  if (parsed.errors.length) throw new Error("Fix the event file's script syntax before editing it");
  return parsed.root.statements;
}

function optionBlock(key: string, eol: string, indent = ""): string {
  return `${indent}\toption = {${eol}${indent}\t\tname = ${key}${eol}${indent}\t}${eol}`;
}

interface PendingWrite {
  body: string;
  disk: Buffer;
  saved: boolean;
  localized: number;
}

/** A failed save or loc write keeps its inserted script recoverable on retry. */
export class EventGraphWriters {
  private readonly pending = new Map<string, PendingWrite>();

  async addOption(
    id: string,
    file: string,
    count: number,
    finish: (key: string) => Promise<void>
  ): Promise<void> {
    namespaceFor(id);
    checkedCount(count, 25);
    const key = `${id}.${String.fromCharCode(97 + count)}`;
    await this.write(
      JSON.stringify(["option", file, id, count]),
      file,
      false,
      (snapshot) => {
        const text = bodyText(snapshot.text);
        const matches = parsedFile(text).filter((s) => s.kind === "assignment" && s.key.text === id);
        const event = matches[0];
        if (matches.length !== 1 || event?.kind !== "assignment" || event.value?.kind !== "block")
          throw new Error(`Event ${id} is missing or ambiguous in the current document`);
        const block = event.value;
        const options = block.statements.filter((s) => s.kind === "assignment" && s.key.text === "option");
        if (options.length !== count)
          throw new Error("The event's options changed. Refresh the graph before adding an option.");
        if (
          options.some(
            (s) =>
              s.kind === "assignment" &&
              s.value?.kind === "block" &&
              s.value.statements.some(
                (n) =>
                  n.kind === "assignment" &&
                  n.key.text === "name" &&
                  n.value?.kind === "scalar" &&
                  n.value.text === key
              )
          )
        )
          throw new Error(`Option ${key} already exists`);
        const close = block.closeBrace;
        if (close === null) throw new Error(`Event ${id} has no closing brace`);
        const eol = eolFor(text);
        const closeLine = text.lastIndexOf("\n", close - 1) + 1;
        const keyLine = text.lastIndexOf("\n", event.key.range.start - 1) + 1;
        const indent = /^\s*$/.test(text.slice(keyLine, event.key.range.start))
          ? text.slice(keyLine, event.key.range.start)
          : "";
        const ownLine = /^[\t ]*$/.test(text.slice(closeLine, close));
        const offset = ownLine ? closeLine : close;
        return (
          text.slice(0, offset) + (ownLine ? "" : eol) + optionBlock(key, eol, indent) + text.slice(offset)
        );
      },
      () => finish(key)
    );
  }

  async createEvent(
    id: string,
    file: string,
    type: string,
    title: string,
    desc: string,
    count: number,
    finish: (key: string, value: string) => Promise<void>
  ): Promise<void> {
    const namespace = namespaceFor(id);
    checkedCount(count, 26);
    if (!/^[A-Za-z0-9_-]+$/.test(type)) throw new Error("Event type must be one script identifier");
    const letters = Array.from({ length: count }, (_, i) => String.fromCharCode(97 + i));
    const localization: Array<[string, string]> = [
      [`${id}.t`, title || "New event"],
      [`${id}.desc`, desc || "Describe what is happening here."],
      ...letters.map((letter): [string, string] => [`${id}.${letter}`, "New option"]),
    ];
    await this.write(
      JSON.stringify(["event", file, id, type, title, desc, count]),
      file,
      true,
      (snapshot) => {
        let text = bodyText(snapshot.text);
        const statements = parsedFile(text);
        if (statements.some((s) => s.kind === "assignment" && s.key.text === id))
          throw new Error(`Event ${id} already exists in the current document`);
        const headers = statements.filter((s) => s.kind === "assignment" && s.key.text === "namespace");
        if (
          headers.length > 1 ||
          headers.some(
            (s) => s.kind !== "assignment" || s.value?.kind !== "scalar" || s.value.text !== namespace
          )
        )
          throw new Error(`The event file must have one namespace = ${namespace} header`);
        const eol = eolFor(text);
        if (!headers.length) text = `namespace = ${namespace}${eol}${eol}${text}`;
        else if (statements[0] !== headers[0])
          throw new Error("The event file must start with its namespace header");
        const sep = text.endsWith(eol + eol) ? "" : text.endsWith(eol) ? eol : eol + eol;
        const options = letters.map((letter) => optionBlock(`${id}.${letter}`, eol)).join("");
        return `${text}${sep}${id} = {${eol}\ttype = ${type}${eol}\ttitle = ${id}.t${eol}\tdesc = ${id}.desc${eol}${options}}${eol}`;
      },
      async (pending) => {
        while (pending.localized < localization.length) {
          const [key, value] = localization[pending.localized];
          await finish(key, value);
          pending.localized++;
        }
      }
    );
  }

  private async write(
    key: string,
    file: string,
    create: boolean,
    build: (snapshot: DocumentSnapshot) => string,
    finish: (pending: PendingWrite) => Promise<void>
  ): Promise<void> {
    const snapshot = await readDocument(file, create);
    let pending = this.pending.get(key);
    if (pending) {
      if (bodyText(snapshot.text) !== pending.body || !snapshot.disk.equals(pending.disk))
        throw new Error(
          "The event file changed after an incomplete write. Restore that document before retrying."
        );
    } else {
      pending = { body: build(snapshot), disk: snapshot.disk, saved: false, localized: 0 };
    }
    try {
      if (!pending.saved) {
        await writeDocument(snapshot, pending.body, true);
        pending.saved = true;
        pending.disk = fs.readFileSync(file);
      }
      await finish(pending);
      this.pending.delete(key);
    } catch (error) {
      // Only our exact buffer advances the graph's source-hash ledger.
      if (bodyText(snapshot.document.getText()) === pending.body) {
        this.pending.set(key, pending);
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          scriptText: snapshot.document.getText(),
        });
      }
      throw error;
    }
  }
}
