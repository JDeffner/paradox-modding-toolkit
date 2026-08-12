/**
 * Pure generator for a standalone TRANSLATION MOD: given another mod's
 * localization files, produce a new mod that overrides/adds one language —
 * descriptor.mod (with a dependency on the source mod), the mirrored loc
 * files with blanked values (`"" # english: …`, see translationCore), a
 * playset.json so the extension indexes the source mod when the translation
 * mod is opened alone, and a TRANSLATE.md with the workflow and a ready-made
 * AI translation prompt.
 *
 * Files go to `localization/<lang>/replace/`: replace wins over whatever the
 * source mod ships for that language (stub files, english copies), and for
 * keys new to the language it behaves like a normal loc file.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import { buildTranslation, detectLocFileLanguage } from "@px-lsp/protocol/translationCore";
import { METADATA_REL_PATH, scaffoldMetadata } from "@px-lsp/protocol/descriptorMetadata";

export interface SourceLocFile {
  /** Path relative to the source mod root, forward or back slashes. */
  relPath: string;
  /** Raw file content (BOM or not). */
  content: string;
}

export interface TranslationModOptions {
  /** Active game display name ("Victoria 3"), for the guide and AI prompt. */
  gameName: string;
  /** Active game short name ("Vic3"), for the guide and AI prompt. */
  gameShortName: string;
  /** The game's tiger validator binary, or null when it has none (EU5). */
  tigerName: string | null;
  /** Per-game config dir (".ck3modding") the playset overlay goes into. */
  configDirName: string;
  /** Which descriptor the game reads, which is the one the new mod gets. */
  descriptorKind: "mod" | "metadata";
  /** The source mod's launcher name (descriptor `name=`), used for the new
   * mod's name and its `dependencies` entry. */
  sourceName: string;
  /** The source mod's metadata `id`, which is what a `relationships` entry
   * points at. Null when it has none (or uses the .mod convention). */
  sourceId?: string | null;
  /** `supported_version` copied from the source descriptor, if known. */
  supportedVersion: string | null;
  sourceLang: string;
  targetLang: string;
  /** Relative path from the new mod root to the source mod root (playset.json),
   * e.g. "../big_mod". Null skips the playset. */
  sourceRootRelative: string | null;
  files: SourceLocFile[];
}

export interface GeneratedFile {
  /** Path relative to the new mod root, forward slashes. */
  relPath: string;
  content: string;
}

/** Entries needing translation: blanked values carrying a source comment. */
function countTranslatable(content: string, sourceLang: string): number {
  const re = new RegExp(`^\\s*[A-Za-z0-9_.\\-']+:\\d*\\s*"" # ${sourceLang}: `);
  let n = 0;
  for (const line of content.split(/\r?\n/)) if (re.test(line)) n++;
  return n;
}

/** `localization/english/sub/x_l_english.yml` → `localization/<t>/replace/sub/x_l_<t>.yml`. */
export function targetLocPath(relPath: string, sourceLang: string, targetLang: string): string {
  const parts = relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "");
  // Drop everything up to and including "localization", then the language
  // and/or replace segments — what remains is the file's own subpath.
  const locIdx = parts.findIndex((p) => p.toLowerCase() === "localization");
  let rest = locIdx >= 0 ? parts.slice(locIdx + 1) : parts;
  while (rest.length > 1 && (rest[0].toLowerCase() === sourceLang || rest[0].toLowerCase() === "replace")) {
    rest = rest.slice(1);
  }
  let filename = rest[rest.length - 1] ?? "";
  const marker = new RegExp(`_l_${sourceLang}(\\.ya?ml)$`, "i");
  if (marker.test(filename)) filename = filename.replace(marker, `_l_${targetLang}$1`);
  else filename = filename.replace(/(\.ya?ml)$/i, `_l_${targetLang}$1`);
  return ["localization", targetLang, "replace", ...rest.slice(0, -1), filename].join("/");
}

/** The new mod's display name, e.g. "Big Mod (German Translation)". */
function translationName(opts: TranslationModOptions): string {
  const displayLang = opts.targetLang.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return `${opts.sourceName} (${displayLang} Translation)`;
}

function descriptor(opts: TranslationModOptions): string {
  const lines = [
    'version="0.1.0"',
    "tags={",
    '\t"Translation"',
    "}",
    `name="${translationName(opts).replace(/"/g, "'")}"`,
  ];
  if (opts.supportedVersion) lines.push(`supported_version="${opts.supportedVersion.replace(/"/g, "'")}"`);
  lines.push("dependencies={", `\t"${opts.sourceName.replace(/"/g, "'")}"`, "}", "");
  return lines.join("\n");
}

/**
 * The metadata-convention twin of `descriptor`. The load-order dependency is a
 * `relationships` entry, which links by the source mod's `id`; without one
 * (a source mod that set no id) the entry is left out rather than guessed, and
 * the playset overlay plus the guide still tie the two mods together.
 */
function metadataDescriptor(opts: TranslationModOptions): string {
  const name = translationName(opts);
  return scaffoldMetadata({
    name,
    id: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, ""),
    supportedGameVersion: opts.supportedVersion ?? "*",
    tags: ["Translation"],
    relationships: opts.sourceId
      ? [
          {
            rel_type: "dependency",
            id: opts.sourceId,
            display_name: opts.sourceName,
            resource_type: "mod",
            version: "*",
          },
        ]
      : [],
  });
}

function translateGuide(
  opts: TranslationModOptions,
  generated: Array<{ relPath: string; entries: number }>
): string {
  const { sourceLang, targetLang, sourceName, gameName, gameShortName, tigerName } = opts;
  const totalEntries = generated.reduce((n, f) => n + f.entries, 0);
  const checklist = generated
    .map((f) => `- [ ] \`${f.relPath}\` (${f.entries} entr${f.entries === 1 ? "y" : "ies"})`)
    .join("\n");

  const prompt = [
    `You are translating ${gameName} mod localization from ${sourceLang} to ${targetLang}.`,
    ``,
    `INPUT FORMAT: a ${gameShortName} localization yml file. The first line is the language header`,
    `(l_${targetLang}:). Each entry is one line:`,
    ``,
    `  some_key:0 "" # ${sourceLang}: The original text`,
    ``,
    `YOUR TASK: output the COMPLETE file with every empty "" filled with the ${targetLang}`,
    `translation of that line's "# ${sourceLang}:" comment text. Keep the trailing comments.`,
    ``,
    `STRICT RULES`,
    `1. Never change keys, the :0 numbers, indentation, line order or count, the`,
    `   l_${targetLang}: header, or comment-only lines.`,
    `2. Copy these VERBATIM, never translate or alter their insides:`,
    `   - $variables$, e.g. $VALUE$, $k_france$`,
    `   - [bracketed script], e.g. [ROOT.Char.GetFirstName], [GetTrait('brave').GetName( CHARACTER.Self )]`,
    `   - icon tags, e.g. @gold_icon! and £gold£`,
    `   - escapes \\n and \\" (keep them at sensible positions in the translation)`,
    `3. Formatting tags like #P ... #! or #bold ... #!: keep the tags, translate only`,
    `   the words between them.`,
    `4. Match the official ${gameShortName} ${targetLang} localization: same register/form of`,
    `   address, same terms for the game's own concepts and mechanics. When unsure about`,
    `   a term, prefer what the vanilla game's ${targetLang} files use.`,
    `5. Character, dynasty and place names stay unless an established ${targetLang} exonym exists.`,
    `6. Keep translations roughly as long as the ${sourceLang} text; UI space is limited.`,
    `7. Entries with no "# ${sourceLang}:" comment, or whose value is already filled in,`,
    `   stay exactly as they are. If the ${sourceLang} text is pure script/tags with no`,
    `   words, copy it into the value unchanged.`,
    `8. Output ONLY the file content. No explanations, no code fences.`,
  ].join("\n");

  return `# Translating ${sourceName} to ${targetLang}

Generated by the Paradox Modding Toolkit. This mod adds/overrides the **${targetLang}**
localization of **${sourceName}**: ${generated.length} file(s), ${totalEntries} entries, scaffolded under
\`localization/${targetLang}/replace/\`. Every value is blank (\`""\`) with the original
${sourceLang} text kept beside it as a \`# ${sourceLang}: ...\` comment. Blank values never
leak wrong-language text into the game, and the extension counts them as
untranslated so you can track progress.

## Workflow

1. Open this folder (or add it to the workspace next to the source mod).
2. Translate file by file: fill each \`""\` using the comment beside it (by hand,
   with **Paradox Localization: Translate Missing Keys**, or with the AI prompt below).
3. Track progress in the Paradox Modding Toolkit sidebar: **Localization Coverage** lists
   every still-untranslated key of this mod.
4. Before testing, sanity-check the format: the extension flags encoding/header
   mistakes${tigerName ? `, and ${tigerName} validates the mod` : ""}.
5. In the launcher, enable both mods; the dependency in \`${opts.descriptorKind === "metadata" ? METADATA_REL_PATH : "descriptor.mod"}\`
   makes this mod load after ${sourceName}.

## AI translation prompt

Copy the block below into your AI assistant, then paste ONE file's complete
content after it and replace the file with the answer. Repeat per file (the
checklist at the bottom tracks which are done). With a CLI assistant you can
also pipe files through it, e.g. \`claude -p "<the prompt>" < file.yml\`.

\`\`\`text
${prompt}
\`\`\`

Review tips: spot-check that no \`$...$\`/\`[...]\`/\`£...£\` token was altered (the
extension highlights broken ones), and load the game once with \`-debug_mode\` to
see the text in place.

## Files

${checklist}
`;
}

export function buildTranslationMod(opts: TranslationModOptions): {
  files: GeneratedFile[];
  locFiles: number;
  entries: number;
} {
  const out: GeneratedFile[] = [];
  const generated: Array<{ relPath: string; entries: number }> = [];
  const seen = new Set<string>();

  for (const src of opts.files) {
    if (detectLocFileLanguage(src.relPath) !== opts.sourceLang) continue;
    const rel = targetLocPath(src.relPath, opts.sourceLang, opts.targetLang);
    if (seen.has(rel.toLowerCase())) continue; // replace/ + plain twin collapsed
    seen.add(rel.toLowerCase());
    const content = buildTranslation(src.content, opts.targetLang, opts.sourceLang);
    out.push({ relPath: rel, content });
    generated.push({ relPath: rel, entries: countTranslatable(content, opts.sourceLang) });
  }
  generated.sort((a, b) => a.relPath.localeCompare(b.relPath));
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));

  out.unshift(
    opts.descriptorKind === "metadata"
      ? { relPath: METADATA_REL_PATH, content: metadataDescriptor(opts) }
      : { relPath: "descriptor.mod", content: descriptor(opts) }
  );
  if (opts.sourceRootRelative) {
    out.push({
      relPath: `${opts.configDirName}/playset.json`,
      content: JSON.stringify({ parents: [opts.sourceRootRelative.replace(/\\/g, "/")] }, null, 2) + "\n",
    });
  }
  out.push({ relPath: "TRANSLATE.md", content: translateGuide(opts, generated) });

  return {
    files: out,
    locFiles: generated.length,
    entries: generated.reduce((n, f) => n + f.entries, 0),
  };
}
