export interface LocalizationDefaults {
  language?: string;
  newKeyFile?: string;
  overrideFile?: string;
  entryVersion?: "preserve" | "none" | "zero";
}

export interface LocalizationDocument {
  path: string;
  text: string;
}

export interface LocalizationTargetInput {
  key: string;
  language: string;
  documents: LocalizationDocument[];
  locRoots: string[];
  defaults?: LocalizationDefaults;
  sourcePath?: string;
  relatedKeys?: string[];
  subject?: string;
  override?: boolean;
  fallbackPath?: string;
}

export interface LocalizationTarget {
  /** Empty when the caller must resolve candidates. */
  path: string;
  reason: string;
  candidates?: string[];
}

const languagePattern = /^[a-z][a-z_]*$/;
const keyPattern = /^[A-Za-z0-9_.\-']+$/;
// Match locParser: the last quote closes the value; inner quotes are literal.
const entryPattern = /^([ \t]*)([A-Za-z0-9_.\-']+)(:[ \t]*)(\d*)([ \t]*")(.*)(".*)$/;

function validateLanguage(language: string): void {
  if (!languagePattern.test(language)) throw new Error("Invalid localization language");
}

function validateKey(key: string): void {
  if (!keyPattern.test(key)) throw new Error("Invalid localization key");
}

function relativePath(path: string, template = false): string {
  if (
    !path ||
    path.startsWith("/") ||
    /[\\:]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Localization paths must be relative paths within the mod");
  const literal = template ? path.replace(/\{(?:language|source|subject)\}/g, "placeholder") : path;
  if (/[{}]/.test(literal)) throw new Error("Unknown localization path placeholder");
  return path;
}

/** Invalid configuration is reported, never silently replaced with defaults. */
export function parseLocalizationDefaults(value: unknown): LocalizationDefaults {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Localization defaults must be an object");
  }
  const version = (value as Record<string, unknown>).version;
  if (version !== undefined && version !== 1)
    throw new Error("Unsupported localization defaults version (expected 1)");
  const result: LocalizationDefaults = {};
  for (const [name, setting] of Object.entries(value)) {
    if (!["language", "newKeyFile", "overrideFile", "entryVersion"].includes(name)) {
      continue;
    }
    if (typeof setting !== "string") throw new Error(`Localization ${name} must be a string`);
    if (name === "language") {
      if (setting) {
        validateLanguage(setting);
        result.language = setting;
      }
    } else if (name === "entryVersion") {
      if (!["preserve", "none", "zero"].includes(setting)) {
        throw new Error("Localization entryVersion must be preserve, none, or zero");
      }
      result.entryVersion = setting as LocalizationDefaults["entryVersion"];
    } else if (name === "newKeyFile" || name === "overrideFile") {
      if (setting) relativePath(setting, true);
      result[name] = setting;
    }
  }
  return result;
}

/** Returns the explicit generator warning from the leading comments, before or after the header. */
export function generatedLocalizationSource(text: string): string | undefined {
  let headerSeen = false;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("#")) {
      if (!headerSeen && /^l_[a-z][a-z_]*:[ \t]*(?:#.*)?$/.test(trimmed)) {
        headerSeen = true;
        continue;
      }
      break;
    }
    if (
      /\b(?:auto[ -]?generated|generated\s+(?:file|by|from)|(?:file|automatically)\s+generated|do\s+not\s+edit)\b/i.test(
        trimmed
      )
    ) {
      return trimmed.replace(/^#+\s*/, "");
    }
  }
  return undefined;
}

function entries(text: string): RegExpExecArray[] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .flatMap((line) => {
      const match = entryPattern.exec(line);
      return match ? [match] : [];
    });
}

function documentLanguage(document: LocalizationDocument): string | undefined {
  const header = document.text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .find((line) => line.trim() && !line.trimStart().startsWith("#"));
  const language = /^\s*l_([a-z][a-z_]*):[ \t]*(?:#.*)?$/.exec(header ?? "")?.[1];
  return language && document.path.endsWith(`_l_${language}.yml`) ? language : undefined;
}

function familyScore(left: string, right: string): number {
  if (left === right) return left.length;
  const a = left.split(/[_.-]/);
  const b = right.split(/[_.-]/);
  let shared = 0;
  while (shared < Math.min(a.length, b.length) && a[shared] === b[shared]) shared++;
  // A mod-wide prefix alone is not evidence of a related definition.
  if (shared < 2) return 0;
  return a.slice(0, shared).join("_").length;
}

function replacePath(path: string): boolean {
  return path.split("/").includes("replace");
}

function stem(path: string): string {
  return (path.split("/").pop() ?? "").replace(/_l_[a-z_]+\.yml$/i, "").replace(/\.[^.]+$/, "");
}

function counterpart(path: string, oldLanguage: string, language: string): string {
  return path
    .split("/")
    .map((part) => (part === oldLanguage ? language : part))
    .join("/")
    .replace(new RegExp(`_l_${oldLanguage}\\.yml$`), `_l_${language}.yml`);
}

function choose(paths: string[], reason: string): LocalizationTarget {
  const candidates = [...new Set(paths)].sort();
  return candidates.length === 1 ? { path: candidates[0], reason } : { path: "", reason, candidates };
}

function fileToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function validateTarget(path: string, language: string, override: boolean, roots: string[]): string {
  relativePath(path);
  if (!roots.some((root) => path.startsWith(`${root}/`))) {
    throw new Error("Localization target must be within a localization root");
  }
  if (!path.endsWith(`_l_${language}.yml`)) {
    throw new Error(`Localization target must end in _l_${language}.yml`);
  }
  if (override && !replacePath(path))
    throw new Error("New localization overrides require a replace directory");
  return path;
}

interface PreparedLocalizationDocument extends LocalizationDocument {
  language?: string;
  keys: string[];
  generated?: string;
}

/** A request can suggest several keys without reparsing its unchanged localization snapshot. */
export function prepareLocalizationTarget(
  input: Omit<LocalizationTargetInput, "key">
): (key: string) => LocalizationTarget {
  const documents = input.documents.map((document): PreparedLocalizationDocument => ({
    ...document,
    language: documentLanguage(document),
    keys: entries(document.text).map((entry) => entry[2]),
    generated: generatedLocalizationSource(document.text),
  }));
  return (key) => suggestPreparedLocalizationTarget({ ...input, key }, documents);
}

export function suggestLocalizationTarget(input: LocalizationTargetInput): LocalizationTarget {
  return prepareLocalizationTarget(input)(input.key);
}

function suggestPreparedLocalizationTarget(
  input: LocalizationTargetInput,
  prepared: PreparedLocalizationDocument[]
): LocalizationTarget {
  validateKey(input.key);
  validateLanguage(input.language);
  const defaults = parseLocalizationDefaults(input.defaults);
  const roots = (input.locRoots.length ? input.locRoots : ["localization"]).map((root) => relativePath(root));
  const documents = prepared.filter((document) => {
    relativePath(document.path);
    return roots.some((root) => document.path.startsWith(`${root}/`));
  });
  const sourceStage = input.sourcePath?.split("/")[0];
  const stageRoots = roots.filter((root) => sourceStage && root.startsWith(`${sourceStage}/`));
  const automaticRoots = stageRoots.length ? stageRoots : roots;
  const automaticDocuments = documents.filter((document) =>
    automaticRoots.some((root) => document.path.startsWith(`${root}/`))
  );
  const owned = automaticDocuments.filter(
    (document) => document.language === input.language && document.keys.includes(input.key)
  );
  if (owned.length)
    return choose(
      owned.map((document) => document.path),
      "existing key"
    );

  const override = input.override ?? false;
  const configured = override ? defaults.overrideFile : defaults.newKeyFile;
  if (configured) {
    const values: Record<string, string> = {
      language: input.language,
      source: input.sourcePath ? fileToken(stem(input.sourcePath)) : "",
      subject: input.subject ? fileToken(input.subject) : "",
    };
    const expanded = configured.replace(/\{(language|source|subject)\}/g, (_, name: string) => {
      if (!values[name]) throw new Error(`Localization template requires ${name}`);
      return values[name];
    });
    const path = validateTarget(expanded, input.language, override, roots);
    const generated = documents.find((document) => document.path === path && document.generated);
    if (generated) throw new Error(`Localization target is generated: ${path}`);
    return { path, reason: "configured default" };
  }

  const eligible = automaticDocuments.filter(
    (document) => (!override || replacePath(document.path)) && !document.generated && document.language
  );
  const related = new Set(input.relatedKeys ?? []);
  const source = input.sourcePath ? stem(input.sourcePath) : undefined;
  const ranked = eligible.flatMap((document) => {
    const keys = document.keys;
    const language = document.language!;
    const sibling = keys.some((key) => related.has(key));
    const family = keys.reduce((best, key) => Math.max(best, familyScore(input.key, key)), 0);
    const sameSource = source !== undefined && stem(document.path) === source;
    const sameKey = keys.includes(input.key);
    const score = sibling ? 30000 : sameKey ? 20000 : family ? 10000 + family : sameSource ? 5000 : 0;
    if (!score) return [];
    const path =
      language === input.language ? document.path : counterpart(document.path, language, input.language);
    // Never infer a generated counterpart as a writable destination.
    if (documents.some((other) => other.path === path && other.generated)) return [];
    return [
      {
        path,
        score: score + (language === input.language ? 1 : 0),
        reason:
          language !== input.language
            ? "language counterpart"
            : sibling
              ? "related key"
              : family
                ? "key family"
                : "source file",
      },
    ];
  });
  if (ranked.length) {
    const highest = ranked.reduce((best, candidate) => Math.max(best, candidate.score), 0);
    const best = ranked.filter((candidate) => candidate.score === highest);
    return choose(
      best.map((candidate) => candidate.path),
      best[0].reason
    );
  }

  const root = automaticRoots[0];
  const name = fileToken(input.sourcePath ? stem(input.sourcePath) : (input.subject ?? "mod")) || "mod";
  const fallback =
    input.fallbackPath ??
    `${root}/${override ? "replace/" : ""}${input.language}/${name}_l_${input.language}.yml`;
  validateTarget(fallback, input.language, override, automaticRoots);
  const languageFiles = eligible.filter((document) => document.language === input.language);
  const layoutFiles = languageFiles.length ? languageFiles : eligible;
  const directories = [
    ...new Set(
      layoutFiles.map((document) => {
        const path = counterpart(document.path, document.language!, input.language);
        return path.slice(0, path.lastIndexOf("/"));
      })
    ),
  ];
  const sharedDirectory = directories
    .reduce<string[]>((shared, directory, index) => {
      const parts = directory.split("/");
      if (index === 0) return parts;
      const different = shared.findIndex((part, i) => parts[i] !== part);
      return different < 0 ? shared : shared.slice(0, different);
    }, [])
    .join("/");
  const observedDirectory = automaticRoots.some(
    (root) => sharedDirectory.startsWith(`${root}/`) || (directories.length === 1 && sharedDirectory === root)
  )
    ? sharedDirectory
    : undefined;
  // Feature subfolders can share a layout, for example english/replace/*.
  // Reuse that common directory, never the largest unrelated file.
  const path =
    documents.some((document) => document.path === fallback) || !observedDirectory
      ? fallback
      : `${observedDirectory}/${fallback.split("/").pop()}`;
  validateTarget(path, input.language, override, automaticRoots);
  if (documents.some((document) => document.path === path && document.generated)) {
    throw new Error(`Localization fallback is generated: ${path}`);
  }
  return {
    path,
    reason: path !== fallback ? "observed layout" : input.fallbackPath ? "fallback" : "new file",
  };
}

interface TextLine {
  text: string;
  eol: string;
}

/** Existing localization documents require one header matching their target language. */
export function assertLocalizationHeader(text: string, language: string): void {
  validateLanguage(language);
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const header = lines.findIndex((line) => line.trim() && !line.trimStart().startsWith("#"));
  if (
    header < 0 ||
    !new RegExp(`^[ \\t]*l_${language}:[ \\t]*(?:#.*)?$`).test(lines[header]) ||
    lines.some((line, index) => index !== header && /^[ \t]*l_[a-z_]+:/.test(line))
  )
    throw new Error(`Localization file needs a single l_${language}: header`);
}

/** Changes only the value of an existing entry; insertion follows nearby style. */
export function upsertLocalizationText(
  text: string,
  language: string,
  key: string,
  value: string,
  entryVersion: NonNullable<LocalizationDefaults["entryVersion"]> = "preserve"
): string {
  validateLanguage(language);
  validateKey(key);
  if (!["preserve", "none", "zero"].includes(entryVersion))
    throw new Error("Invalid localization entry version");
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = text.slice(bom.length);
  const eol = /\r\n|\r|\n/.exec(body)?.[0] ?? "\n";
  const lines: TextLine[] = [...body.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)]
    .filter((match) => match[0] !== "")
    .map((match) => ({ text: match[1], eol: match[2] }));
  if (body.length === 0) lines.push({ text: `l_${language}:`, eol });
  else assertLocalizationHeader(text, language);
  const escaped = value
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/\\"/g, '"')
    .replace(/"/g, '\\"');
  const matches = lines.flatMap((line, index) => {
    const match = entryPattern.exec(line.text);
    return match ? [{ match, index }] : [];
  });
  const occurrences = lines.filter((line) => /^[ \t]*([^: \t]+):/.exec(line.text)?.[1] === key);
  if (occurrences.length > 1) throw new Error(`Duplicate localization key: ${key}`);
  const existing = matches.find((entry) => entry.match[2] === key);
  if (existing) {
    const match = existing.match;
    lines[existing.index].text = match.slice(1, 6).join("") + escaped + match[7];
  } else {
    if (occurrences.length) throw new Error(`Malformed localization entry: ${key}`);
    const family = matches.map((entry) => ({ ...entry, score: familyScore(key, entry.match[2]) }));
    const score = family.reduce((best, entry) => Math.max(best, entry.score), 0);
    const nearby = score ? family.filter((entry) => entry.score === score).at(-1) : matches.at(-1);
    const style = nearby?.match;
    const version = entryVersion === "zero" ? "0" : entryVersion === "none" ? "" : (style?.[4] ?? "");
    const line = `${style?.[1] ?? " "}${key}${style?.[3] ?? ":"}${version}${style?.[5] ?? ' "'}${escaped}"`;
    const position = score && nearby ? nearby.index + 1 : lines.length;
    const previous = lines[position - 1];
    const ending = previous?.eol || eol;
    if (previous && !previous.eol) previous.eol = eol;
    lines.splice(position, 0, { text: line, eol: ending });
  }
  return bom + lines.map((line) => line.text + line.eol).join("");
}
