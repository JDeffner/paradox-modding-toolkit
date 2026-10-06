import { describe, expect, it } from "vitest";
import { fork } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CodeAction, ClientCapabilities, TextDocumentEdit, TextEdit } from "vscode-languageserver/node";
import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";

const server = path.join(__dirname, "../dist/server.js");
const cases: {
  name: string;
  capabilities: ClientCapabilities;
  versioned: boolean;
  creation: boolean;
  disabled: boolean;
}[] = [
  { name: "absent capabilities", capabilities: {}, versioned: false, creation: false, disabled: false },
  {
    name: "documentChanges without CreateFile",
    capabilities: {
      workspace: { workspaceEdit: { documentChanges: true } },
      textDocument: { codeAction: { disabledSupport: true } },
    },
    versioned: true,
    creation: false,
    disabled: true,
  },
  {
    name: "CreateFile without documentChanges",
    capabilities: {
      workspace: { workspaceEdit: { resourceOperations: ["create"] } },
      textDocument: { codeAction: { disabledSupport: true } },
    },
    versioned: false,
    creation: false,
    disabled: true,
  },
  {
    name: "supported creation",
    capabilities: {
      workspace: { workspaceEdit: { documentChanges: true, resourceOperations: ["create"] } },
      textDocument: { codeAction: { disabledSupport: true } },
    },
    versioned: true,
    creation: true,
    disabled: true,
  },
];

describe.skipIf(!fs.existsSync(server))("LSP localization WorkspaceEdit capabilities", () => {
  it.each(cases)(
    "applies only supported edits with $name",
    async ({ capabilities, versioned, creation, disabled }) => {
      const testing = path.resolve(__dirname, "../../../.local/testing");
      fs.mkdirSync(testing, { recursive: true });
      const fixture = fs.mkdtempSync(path.join(testing, "language-lsp-"));
      const mod = path.join(fixture, "mod");
      const target = path.join(mod, "localization/english/group_l_english.yml");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const saved = '\uFEFFl_english:\n # keep\n some_group_desc:4 "saved"\n unrelated:2 "keep"\n';
      fs.writeFileSync(target, saved);
      const targetUri = URI.file(target).toString();
      const sourceUri = URI.file(path.join(mod, "events/actions.txt")).toString();
      const child = fork(server, ["--node-ipc"], { stdio: ["ignore", "pipe", "pipe", "ipc"], silent: true });
      const conn = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
      conn.onNotification(() => undefined);
      conn.onRequest("window/workDoneProgress/create", () => null);
      conn.listen();
      const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } };
      const request = (key: string) =>
        conn.sendRequest<CodeAction[]>("textDocument/codeAction", {
          textDocument: { uri: sourceUri },
          range,
          context: {
            diagnostics: [
              { range, message: "Missing localization", code: "missing-required-loc", data: { key } },
            ],
          },
        });
      try {
        await conn.sendRequest("initialize", {
          processId: process.pid,
          rootUri: URI.file(mod).toString(),
          capabilities,
          initializationOptions: {
            storageDir: path.join(fixture, "storage"),
            client: { commands: [] },
            settings: {
              gamePath: null,
              logsPath: null,
              modPath: mod,
              parentPaths: [],
              locLanguage: "english",
            },
          },
        });
        await conn.sendNotification("initialized", {});
        await conn.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: sourceUri,
            languageId: "paradox",
            version: 1,
            text: "namespace = actions\nactions.1 = {}\n",
          },
        });
        const [closed] = await request("some_group_title");
        expect(closed.disabled).toBeUndefined();
        const edit = closed.edit!;
        const edits = versioned
          ? (edit.documentChanges![0] as TextDocumentEdit).edits
          : edit.changes![targetUri];
        if (!versioned) expect(edit.documentChanges).toBeUndefined();
        const updated = TextDocument.applyEdits(
          TextDocument.create(targetUri, "paradox-loc", 0, saved),
          edits as TextEdit[]
        );
        expect(updated).toContain(' some_group_title:4 ""\n');
        expect(updated).toContain(' unrelated:2 "keep"\n');
        expect(updated).toContain(" # keep\n");

        const create = await request("unowned_title");
        if (creation) {
          expect(create[0].edit!.documentChanges![0]).toMatchObject({ kind: "create" });
        } else if (disabled) {
          expect(create[0].edit).toBeUndefined();
          expect(create[0].disabled?.reason).toContain("CreateFile");
        } else expect(create).toEqual([]);

        await conn.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: targetUri,
            languageId: "paradox-loc",
            version: 9,
            text: saved.replace('"saved"', '"draft"'),
          },
        });
        const open = await request("some_group_title");
        if (versioned) {
          expect((open[0].edit!.documentChanges![0] as TextDocumentEdit).textDocument).toEqual({
            uri: targetUri,
            version: 9,
          });
        } else if (disabled) {
          expect(open[0].edit).toBeUndefined();
          expect(open[0].disabled?.reason).toContain("open localization document");
        } else expect(open).toEqual([]);
        expect(fs.readFileSync(target, "utf8")).toBe(saved);
        expect(fs.existsSync(path.join(mod, "localization/english/actions_l_english.yml"))).toBe(false);
        await conn.sendRequest("shutdown");
        await conn.sendNotification("exit");
      } finally {
        conn.dispose();
        child.kill();
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    },
    30_000
  );
});
