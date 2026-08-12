/**
 * Generic writer for the per-game "New Content" templates. NO vscode imports,
 * unit-tested. The CONTENT of every template lives in its game's profile
 * (GameMeta.scaffolds); what lives here are the rules that hold for all of
 * them: the file layout a game silently needs (correct folder, UTF-8-with-BOM
 * loc whose `l_<lang>:` header and `_l_<lang>.yml` filename match, event
 * namespace declared) plus the load-stage prefix of games that have one.
 *
 * Template strings use tabs for indentation and LF only; the writer converts EOL
 * and prepends the BOM per the `bom` flag.
 */
import type { ScaffoldTemplate } from "@px-lsp/server/games/profile";

export interface ScaffoldFile {
  /** Mod-relative path with forward slashes (e.g. `events/foo_events.txt`). */
  relPath: string;
  /** Full new-file content, used when the file does not already exist. */
  content: string;
  /** True → write a UTF-8 BOM when creating the file (all vanilla files carry one). */
  bom: boolean;
  /**
   * When true and the target already exists, the writer appends rather than
   * skips. It appends `appendContent` if present, else `content`.
   */
  appendIfExists?: boolean;
  /**
   * The block to append when the file already exists — just the new entry,
   * without the namespace/header preamble that `content` carries.
   */
  appendContent?: string;
  /**
   * A line the file MUST start with (e.g. `namespace = x` for event files —
   * the game silently drops events otherwise and tiger errors). When the
   * existing file does not start with it, the writer prepends it.
   */
  requiredHeader?: string;
}

export interface ScaffoldResult {
  files: ScaffoldFile[];
  /**
   * Where the cursor should land. `line`/`character` are 0-based and relative to
   * the content that gets written for `relPath` (the full `content` for a fresh
   * file, or `appendContent` for an appended block — the caller offsets it).
   */
  cursor: { relPath: string; line: number; character: number };
}

/** What a template's placeholders expand to for this one invocation. */
export interface ScaffoldVars {
  /** The mod prefix (`$PREFIX$`). */
  prefix: string;
  /** The event id or key the user gave (`$NAME$`). */
  name: string;
  /** Loc language (`$LANG$`). */
  locLanguage: string;
  /** The game's load-stage folder, prefixed onto every path when it has one. */
  stageRoot?: string;
}

/** 0-based line index of the first line whose (trimmed) text equals `needle`. */
function lineOf(content: string, needle: string): number {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === needle) return i;
  }
  return 0;
}

/**
 * Expand the four template placeholders. `$KEY$` is `$NAME$` with dots turned
 * into underscores, for games whose loc keys cannot carry the dot an event id
 * has. Anything else in `$...$` form is content (a scripted effect's own
 * `$PARAM$`) and is left alone.
 */
function expand(text: string, vars: ScaffoldVars): string {
  return text.replace(/\$(PREFIX|NAME|KEY|LANG)\$/g, (_match, token: string) => {
    switch (token) {
      case "PREFIX":
        return vars.prefix;
      case "NAME":
        return vars.name;
      case "KEY":
        return vars.name.replace(/\./g, "_");
      default:
        return vars.locLanguage;
    }
  });
}

/** Turn one game template into the files to write. */
export function renderScaffold(template: ScaffoldTemplate, vars: ScaffoldVars): ScaffoldResult {
  // Content of a game with load-stage roots is only loaded under one of them,
  // so a scaffold written at the mod root would be dead on arrival.
  const at = (relPath: string): string =>
    vars.stageRoot ? `${vars.stageRoot}/${expand(relPath, vars)}` : expand(relPath, vars);

  const block = expand(template.block, vars);
  const header = template.requiredHeader ? expand(template.requiredHeader, vars) : undefined;
  const scriptPath = at(template.scriptPath);
  const files: ScaffoldFile[] = [
    {
      relPath: scriptPath,
      content: header ? `${header}\n\n${block}` : block,
      bom: true, // vanilla script files all carry a UTF-8 BOM; tiger warns without it
      appendIfExists: true,
      appendContent: block,
      requiredHeader: header,
    },
  ];

  if (template.locPath && template.locBody) {
    const locBody = expand(template.locBody, vars);
    files.push({
      relPath: at(template.locPath),
      content: `l_${vars.locLanguage}:\n${locBody}`,
      bom: true,
      appendIfExists: true,
      appendContent: locBody,
    });
  }

  // The cursor lands on the template's marker comment, indented as deeply as
  // the marker itself is.
  const content = files[0].content;
  const line = lineOf(content, expand(template.cursorMarker, vars));
  const text = content.split("\n")[line] ?? "";
  return {
    files,
    cursor: { relPath: scriptPath, line, character: text.length - text.trimStart().length },
  };
}
