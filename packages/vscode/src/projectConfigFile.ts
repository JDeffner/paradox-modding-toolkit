import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { canonicalConfigPath, resolveConfigPath, type ConfigDirNames } from "@px-lsp/protocol/configDir";
import { parseProjectSettings, type ProjectSettings } from "@px-lsp/protocol/projectSettings";
import { assertDocumentCurrent, readDocument, writeDocument, type DocumentSnapshot } from "./documentWrite";

function openDocument(file: string): vscode.TextDocument | undefined {
  const normalize = (value: string) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return vscode.workspace.textDocuments?.find(
    (doc) => doc.uri.scheme === "file" && normalize(doc.uri.fsPath) === normalize(file)
  );
}

/** Existing invalid files are errors. Only a missing artifact has no text. */
export function readProjectConfigText(
  root: string,
  names: ConfigDirNames,
  relative: string
): string | undefined {
  const file = resolveConfigPath(root, names, relative);
  const document = openDocument(file);
  if (document) return document.getText();
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        fs.lstatSync(file);
      } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      }
    }
    throw error;
  }
}

/** Read portable rules from the selected mod, including its current editor text. */
export function readProjectAuthoringSettings(
  root: string,
  names: ConfigDirNames,
  gameId: string
): ProjectSettings | undefined {
  const text = readProjectConfigText(root, names, "project.json");
  return text === undefined
    ? undefined
    : parseProjectSettings(JSON.parse(text.replace(/^\uFEFF/, "")), gameId);
}

/** Capture both source and destination before a picker or other asynchronous work. */
export async function prepareProjectConfigWrite(
  root: string,
  names: ConfigDirNames,
  relative: string
): Promise<{
  source: string;
  target: string;
  text: string | undefined;
  assertCurrent(): void;
  write(text: string): Promise<void>;
}> {
  const physicalRoot = fs.realpathSync(root);
  const source = resolveConfigPath(root, names, relative);
  const target = canonicalConfigPath(root, names, relative);
  const snapshot = fs.existsSync(source) ? await readDocument(source) : undefined;
  const absentDocument = openDocument(target);
  const absentText = absentDocument?.getText();
  const absentVersion = absentDocument?.version;
  if (!snapshot && readProjectConfigText(root, names, relative) !== undefined)
    throw new Error(`Save ${path.basename(source)} before editing its configuration`);
  const assertCurrent = () => {
    if (fs.realpathSync(root) !== physicalRoot)
      throw new Error("The selected mod folder changed during the operation. Try again.");
    canonicalConfigPath(root, names, relative);
    if (resolveConfigPath(root, names, relative) !== source)
      throw new Error(`${path.basename(target)} changed during the operation. Try again.`);
    if (snapshot) assertDocumentCurrent(snapshot);
    if (source !== target || !snapshot) {
      if (
        fs.existsSync(target) ||
        openDocument(target) !== absentDocument ||
        (absentDocument &&
          (absentDocument.isClosed ||
            absentDocument.version !== absentVersion ||
            absentDocument.getText() !== absentText))
      )
        throw new Error(`${path.basename(target)} changed during the operation. Try again.`);
      if (absentText) throw new Error(`Save ${path.basename(target)} before editing its configuration`);
    }
  };
  return {
    source,
    target,
    text: snapshot?.text,
    assertCurrent,
    async write(text) {
      assertCurrent();
      const destination = source === target && snapshot ? snapshot : await readDocument(target, true);
      if (destination !== snapshot && (!destination.created || destination.text !== (absentText ?? "")))
        throw new Error(`${path.basename(target)} changed during the operation. Try again.`);
      const sources: DocumentSnapshot[] = snapshot && snapshot !== destination ? [snapshot] : [];
      await writeDocument(destination, text, false, sources);
    },
  };
}
