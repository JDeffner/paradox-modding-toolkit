import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const BOM = "\uFEFF";

/** Both copies matter: a dirty editor and an external disk edit must survive. */
export interface DocumentSnapshot {
  document: vscode.TextDocument;
  text: string;
  disk: Buffer;
  version: number;
  /** Newly created on disk and no surviving editor content to merge or append. */
  created: boolean;
}

export async function readDocument(file: string, create = false): Promise<DocumentSnapshot> {
  let created = false;
  let disk: Buffer;
  try {
    disk = fs.readFileSync(file);
  } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Exclusive creation must not replace a file that appeared since the read.
    fs.writeFileSync(file, "", { encoding: "utf8", flag: "wx" });
    disk = Buffer.alloc(0);
    created = true;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const text = document.getText();
  if (created && text !== "" && document.encoding === undefined) {
    // Older hosts expose only the disk BOM as evidence of the editor encoder.
    // After deletion, guessing could add a second BOM or omit the required one.
    throw new Error(
      `Save ${path.basename(file)} in the editor before trying again so its encoding can be checked`
    );
  }
  // An externally deleted file may still have a dirty editor buffer. Its text
  // remains existing content even though the backing file had to be recreated.
  const snapshot = {
    document,
    text,
    version: document.version,
    disk,
    created: created && text.replace(/^\uFEFF/, "") === "",
  };
  assertDocumentCurrent(snapshot);
  return snapshot;
}

export function assertDocumentCurrent(snapshot: DocumentSnapshot): void {
  const { document, text, version, disk } = snapshot;
  if (
    document.isClosed ||
    document.version !== version ||
    document.getText() !== text ||
    !fs.readFileSync(document.uri.fsPath).equals(disk)
  ) {
    throw new Error(`${path.basename(document.uri.fsPath)} changed during the operation. Try again.`);
  }
}

/** One editor edit and a checked save. Failed saves leave the buffer recoverable. */
export async function writeDocument(
  snapshot: DocumentSnapshot,
  body: string,
  bom: boolean,
  sources: readonly DocumentSnapshot[] = []
): Promise<void> {
  const { document, text, disk } = snapshot;
  const encoding =
    document.encoding ??
    (text.startsWith(BOM) ? "utf8" : disk.toString("utf8").startsWith(BOM) ? "utf8bom" : "utf8");
  if (encoding !== "utf8" && encoding !== "utf8bom") {
    throw new Error(`Save ${path.basename(document.uri.fsPath)} as UTF-8 before editing it`);
  }
  const needsBom = bom || text.startsWith(BOM) || disk.toString("utf8").startsWith(BOM);
  const replacement = (needsBom && encoding !== "utf8bom" ? BOM : "") + body.replace(/^\uFEFF/, "");
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
    replacement
  );
  for (const source of sources) assertDocumentCurrent(source);
  assertDocumentCurrent(snapshot);
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error("Document edit was rejected");
  if (!(await document.save())) throw new Error(`${path.basename(document.uri.fsPath)} could not be saved`);
}
