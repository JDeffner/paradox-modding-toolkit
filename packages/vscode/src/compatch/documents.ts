import * as vscode from "vscode";
import * as path from "node:path";
import type { MigrationDocument, MigrationDocumentHost } from "@px-lsp/server/migrations/node/files";
import { physicalPath } from "../modWrite";

const within = (root: string, filename: string) => {
  const relative = path.relative(root, filename);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const record = (relative: string, doc: vscode.TextDocument): MigrationDocument => ({
  path: relative,
  text: doc.getText(),
  version: doc.version,
  dirty: doc.isDirty,
});

export function patchDocuments(root: string): MigrationDocument[] {
  const canonicalRoot = physicalPath(root);
  return vscode.workspace.textDocuments.flatMap((doc) => {
    if (doc.isClosed || doc.uri.scheme !== "file") return [];
    const filename = physicalPath(doc.uri.fsPath);
    return within(canonicalRoot, filename)
      ? [record(path.relative(canonicalRoot, filename).split(path.sep).join("/"), doc)]
      : [];
  });
}

export function patchDocumentHost(root: string): MigrationDocumentHost {
  const find = (relative: string) =>
    vscode.workspace.textDocuments.find(
      (doc) =>
        !doc.isClosed &&
        doc.uri.scheme === "file" &&
        path.relative(physicalPath(doc.uri.fsPath), physicalPath(path.resolve(root, relative))) === ""
    );
  const edit = async (relative: string, text: string, expectedVersion: number, save: boolean) => {
    const doc = find(relative);
    if (!doc || doc.version !== expectedVersion)
      throw new Error(`Editor changed: ${relative}. Prepare a new preview.`);
    const changes = new vscode.WorkspaceEdit();
    changes.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    if (!(await vscode.workspace.applyEdit(changes)))
      throw new Error(`Editor rejected changes to ${relative}.`);
    if (save && !(await doc.save())) throw new Error(`Could not save ${relative}.`);
    return record(relative, doc);
  };
  return {
    list: async () => patchDocuments(root),
    read: async (relative) => {
      const doc = find(relative);
      return doc && record(relative, doc);
    },
    write: (relative, text, version) => edit(relative, text, version, true),
    restore: async (relative, original, version) => {
      const doc = find(relative);
      if (doc && doc.getText() === original.text && doc.isDirty === original.dirty)
        return record(relative, doc);
      return edit(relative, original.text, version, !original.dirty);
    },
  };
}
