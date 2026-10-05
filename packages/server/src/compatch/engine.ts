import { parseScript } from "../parser/parser";
import { parseLoc } from "../parser/locParser";
import { suggestLocalizationTarget } from "@px-lsp/protocol/localizationPolicy";
import type { AssignmentNode, Statement } from "../parser/cst";
import type {
  PatchAnalysis,
  PatchContribution,
  PatchDesiredFile,
  PatchDesiredOutput,
  PatchEntry,
  PatchFile,
  PatchPolicy,
  PatchProject,
  PatchResolution,
  PatchSnapshot,
  PatchSource,
} from "./model";
import { parsePatchProject, parsePatchResolution, validatePatchPath } from "./project";

/** SHA-256 is available in the browser language service and supported Node runtimes. */
export async function hashPatchText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface Contribution extends PatchContribution {
  start: number;
  end: number;
  priority?: number;
  language?: string;
  fieldOrder: string[];
  fieldsSupported: boolean;
  issues: string[];
}
interface Inventory {
  entries: Map<string, { name: string; kind: PatchEntry["kind"]; contributors: Contribution[] }>;
  effective: Map<string, { source: PatchSource; file: PatchFile }>;
  issues: string[];
}
const assignments = (statements: Statement[]) =>
  statements.filter((node): node is AssignmentNode => node.kind === "assignment");
const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
const normalize = (text: string) => text.replace(/^\uFEFF/u, "").replace(/\r\n/gu, "\n");
const bom = (text: string) => `\uFEFF${text.replace(/^\uFEFF/u, "")}`;
const stableId = (...parts: (string | number)[]) => JSON.stringify(parts);

function filePrecedence(path: string, policy: PatchPolicy): "first" | "last" {
  if (within(path, policy.localizationFolder) && path.split("/").includes("replace")) return "first";
  return policy.fileRules.find((rule) => within(path, rule.path))?.precedence ?? "last";
}
function declaration(node: AssignmentNode, policy: PatchPolicy): boolean {
  return node.key.text.startsWith("@") || node.key.text === policy.eventRules?.namespaceKey;
}
function contextFor(
  text: string,
  node: AssignmentNode,
  roots: AssignmentNode[],
  policy: PatchPolicy
): string {
  const required = new Set<string>(text.slice(node.range.start, node.range.end).match(/@[\w]+/gu) ?? []);
  const constants = roots.filter((item) => item.key.text.startsWith("@"));
  for (let size = -1; size !== required.size;) {
    size = required.size;
    for (const item of constants)
      if (required.has(item.key.text)) {
        for (const reference of text.slice(item.range.start, item.range.end).match(/@[\w]+/gu) ?? [])
          required.add(reference);
      }
  }
  return roots
    .filter(
      (item) =>
        required.has(item.key.text) ||
        (item.key.text === policy.eventRules?.namespaceKey &&
          item.value?.kind === "scalar" &&
          node.key.text.startsWith(`${item.value.text}.`))
    )
    .map((item) => text.slice(item.range.start, item.range.end))
    .join("\n");
}

/** Repeated direct keys form one indivisible group. Interleaved groups cannot be reordered safely. */
function fieldGroups(
  text: string,
  node: AssignmentNode
): Pick<Contribution, "fields" | "fieldOrder" | "fieldsSupported"> {
  const fields: Record<string, string> = Object.create(null);
  const fieldOrder: string[] = [];
  if (node.value?.kind !== "block") return { fields, fieldOrder, fieldsSupported: false };
  const children = assignments(node.value.statements);
  let previousEnd = node.value.openBrace + 1;
  let previousKey: string | undefined;
  let supported = children.length === node.value.statements.length;
  for (const child of children) {
    const key = child.key.text;
    if (Object.hasOwn(fields, key) && previousKey !== key) supported = false;
    if (!Object.hasOwn(fields, key)) fieldOrder.push(key);
    fields[key] = (fields[key] ?? "") + text.slice(previousEnd, child.range.end);
    previousEnd = child.range.end;
    previousKey = key;
  }
  if (previousKey) fields[previousKey] += text.slice(previousEnd, node.value.closeBrace ?? previousEnd);
  return { fields, fieldOrder, fieldsSupported: supported };
}

/** Descriptor dependencies identify names, not stable source IDs or inferred engine priorities. */
function dependencyAdvisories(sources: PatchSource[]): string[] {
  const names = new Map<string, { source: PatchSource; index: number }[]>();
  for (const [index, source] of sources.entries()) {
    const matches = names.get(source.name) ?? [];
    matches.push({ source, index });
    names.set(source.name, matches);
  }
  const issues: string[] = [];
  for (const [name, matches] of names) {
    if (matches.length > 1)
      issues.push(
        `Duplicate descriptor name ${JSON.stringify(name)} belongs to selected sources ${matches.map(({ source }) => source.id).join(", ")}; dependency matching by name is ambiguous.`
      );
  }
  for (const [index, source] of sources.entries()) {
    for (const dependency of new Set(source.dependencies)) {
      const matches = names.get(dependency) ?? [];
      const prefix = `${source.name} (${source.id}): descriptor dependency ${JSON.stringify(dependency)}`;
      if (!matches.length) issues.push(`${prefix} is missing from selected inputs.`);
      else if (matches.length > 1)
        issues.push(`${prefix} is ambiguous; multiple selected sources have that exact name.`);
      else if (matches[0].source.id === source.id) issues.push(`${prefix} refers to the source itself.`);
      else if (matches[0].index > index)
        issues.push(`${prefix} appears later than its dependent in the selected launcher order.`);
    }
  }
  return issues;
}

function inventory(snapshot: PatchSnapshot, project: PatchProject, policy: PatchPolicy): Inventory {
  const entries: Inventory["entries"] = new Map();
  const effective: Inventory["effective"] = new Map();
  const issues: string[] = [];
  const sourcesById = new Map(snapshot.sources.map((source) => [source.id, source]));
  if (sourcesById.size !== snapshot.sources.length) throw new Error("Duplicate snapshot source ID");
  const sources = project.inputs.map((input) => {
    const source = sourcesById.get(input.id);
    if (!source) throw new Error(`Patch source is missing: ${input.id}`);
    return source;
  });
  if (sources.length !== snapshot.sources.length)
    throw new Error("Snapshot contains sources outside the patch project");
  issues.push(...dependencyAdvisories(sources));
  for (const source of sources) {
    const paths = new Set<string>();
    issues.push(...source.issues.map((issue) => `${source.name}: ${issue}`));
    for (const path of source.replacePaths) validatePatchPath(path);
    for (const file of source.files) {
      validatePatchPath(file.path);
      if (paths.has(file.path.toLowerCase()))
        throw new Error(`Duplicate source file: ${source.name}/${file.path}`);
      paths.add(file.path.toLowerCase());
      if (!effective.has(file.path) || filePrecedence(file.path, policy) === "last")
        effective.set(file.path, { source, file });
    }
  }
  const add = (id: string, name: string, kind: PatchEntry["kind"], contribution: Contribution) => {
    const entry = entries.get(id) ?? { name, kind, contributors: [] };
    entry.contributors.push(contribution);
    entries.set(id, entry);
  };
  for (const source of sources)
    for (const file of source.files) {
      let fileIssues = [
        "This folder or file shape has no verified definition composition rule; choose a complete file explicitly.",
      ];
      const active = effective.get(file.path)?.source.id === source.id;
      const reason = active
        ? undefined
        : `Whole file is shadowed by ${effective.get(file.path)?.source.name} (${file.path}).`;
      const base = { sourceId: source.id, sourceName: source.name, path: file.path, active, reason };
      const script = policy.scriptFolders.find(
        (folder) => within(file.path, folder.path) && file.path.endsWith(".txt")
      );
      if (script) {
        const parsed = parseScript(file.text);
        const roots = assignments(parsed.root.statements);
        const duplicates = new Map<string, number>();
        if (parsed.errors.length || roots.length !== parsed.root.statements.length) {
          add(`file:${file.path}`, file.path, "file", {
            ...base,
            id: stableId(source.id, file.path, "file"),
            text: file.text,
            context: "",
            fields: {},
            fieldOrder: [],
            fieldsSupported: false,
            start: 0,
            end: file.text.length,
            issues: ["Malformed or unsupported script shape requires a complete manual file."],
          });
          continue;
        }
        for (const node of roots.filter(
          (item) =>
            !item.key.text.startsWith("@") &&
            !(script.kind === "event" && item.key.text === policy.eventRules?.namespaceKey)
        )) {
          const name = node.key.text;
          const occurrence = duplicates.get(name) ?? 0;
          duplicates.set(name, occurrence + 1);
          const id = `${script.kind}:${script.path}:${name}`;
          const context = contextFor(file.text, node, roots, policy);
          const contributionIssues: string[] = [];
          let priority: number | undefined;
          if (script.kind === "event" && policy.eventRules) {
            const declarations = roots.filter((item) => item.key.text === policy.eventRules!.namespaceKey);
            if (
              !declarations.some(
                (item) => item.value?.kind === "scalar" && name.startsWith(`${item.value.text}.`)
              )
            )
              contributionIssues.push("Event ID has no matching namespace declaration.");
            const nodes =
              node.value?.kind === "block"
                ? assignments(node.value.statements).filter(
                    (item) => item.key.text === policy.eventRules!.priorityKey
                  )
                : [];
            if (!nodes.length) priority = policy.eventRules.defaultPriority;
            else if (
              nodes.length === 1 &&
              nodes[0].value?.kind === "scalar" &&
              /^-?\d+$/u.test(nodes[0].value.text)
            ) {
              const candidate = Number(nodes[0].value.text);
              if (Number.isSafeInteger(candidate)) priority = candidate;
            }
            if (priority === undefined)
              contributionIssues.push("Event override priority is not one safe literal integer.");
          }
          const groups = fieldGroups(file.text, node);
          add(id, name, script.kind, {
            ...base,
            id: stableId(source.id, file.path, id, occurrence),
            text: file.text.slice(node.range.start, node.range.end),
            context,
            ...groups,
            fieldsSupported: groups.fieldsSupported && script.fields === "direct",
            start: node.range.start,
            end: node.range.end,
            priority,
            issues: contributionIssues,
          });
        }
        continue;
      }
      if (within(file.path, policy.localizationFolder) && file.path.endsWith(".yml")) {
        const parsed = parseLoc(file.text);
        const language = parsed.language;
        const valid = !parsed.errors.length && language && file.path.endsWith(`_l_${language}.yml`);
        if (!valid)
          fileIssues = [
            "Malformed localization or a language/filename mismatch requires a complete manual file.",
          ];
        if (valid && parsed.entries.length) {
          const occurrences = new Map<string, number>();
          for (const loc of parsed.entries) {
            const id = `localization:${language}:${loc.key}`;
            const index = occurrences.get(id) ?? 0;
            occurrences.set(id, index + 1);
            const start = file.text.lastIndexOf("\n", loc.keyRange.start - 1) + 1;
            const newline = file.text.indexOf("\n", loc.keyRange.end);
            const end = newline < 0 ? file.text.length : newline;
            add(id, loc.key, "localization", {
              ...base,
              id: stableId(source.id, file.path, id, index),
              text: file.text.slice(start, end).replace(/\r$/u, ""),
              context: `l_${language}:`,
              fields: {},
              fieldOrder: [],
              fieldsSupported: false,
              start,
              end,
              language,
              issues: [],
            });
          }
          continue;
        }
      }
      add(`file:${file.path}`, file.path, "file", {
        ...base,
        id: stableId(source.id, file.path, "file"),
        text: file.text,
        context: "",
        fields: {},
        fieldOrder: [],
        fieldsSupported: false,
        start: 0,
        end: file.text.length,
        issues: fileIssues,
      });
    }
  return { entries, effective, issues };
}

function chooseWinner(
  kind: PatchEntry["kind"],
  contributors: Contribution[],
  policy: PatchPolicy
): { winner?: string; issues: string[] } {
  const active = contributors.filter((item) => item.active);
  if (!active.length) return { issues: [] };
  if (active.length === 1) return { winner: active[0].id, issues: [] };
  if (kind === "localization") {
    const replacements = active.filter((item) => item.path.split("/").includes("replace"));
    if (replacements.length) return { winner: replacements[0].id, issues: [] };
    return { issues: ["Cross-file ordinary localization precedence is not verified."] };
  }
  if (kind === "event" && policy.eventRules && active.every((item) => item.priority !== undefined)) {
    if (new Set(active.map((item) => item.path)).size !== active.length)
      return { issues: ["Repeated event IDs within one file require a complete manual file."] };
    if (new Set(active.map((item) => item.priority)).size !== active.length)
      return { issues: ["Equal event override priorities are an engine error, not a load-order winner."] };
    const highest = Math.max(...active.map((item) => item.priority!));
    const winners = active.filter((item) => item.priority === highest);
    if (winners.length === 1) return { winner: winners[0].id, issues: [] };
    return { issues: ["Equal event override priorities are an engine error, not a load-order winner."] };
  }
  return {
    issues: ["Cross-file definition precedence is not verified; a load-order winner cannot be inferred."],
  };
}

export async function analyzePatch(
  snapshot: PatchSnapshot,
  project: PatchProject,
  policy: PatchPolicy
): Promise<PatchAnalysis> {
  parsePatchProject(project, snapshot.gameId);
  // A frozen JSON snapshot keeps analysis independent of later caller mutations.
  snapshot = JSON.parse(JSON.stringify(snapshot)) as PatchSnapshot;
  policy = JSON.parse(JSON.stringify(policy)) as PatchPolicy;
  const scanned = inventory(snapshot, project, policy);
  const entries: PatchEntry[] = [];
  for (const [id, group] of scanned.entries) {
    const { contributors, kind, name } = group;
    const selection = chooseWinner(kind, contributors, policy);
    const affectedReplace = snapshot.sources.flatMap((source) =>
      source.replacePaths
        .filter((path) => contributors.some((item) => within(item.path, path)))
        .map((path) => [source.id, path])
    );
    const issues = [...selection.issues, ...contributors.flatMap((item) => item.issues)];
    if (affectedReplace.length)
      issues.push("replace_path affects this entry; suppression of prior mod sources is unverified.");
    const decision = Object.hasOwn(project.decisions, id) ? project.decisions[id] : undefined;
    const noLoss = contributors.some((item) => item.active);
    const ordinaryFile = kind === "file" && contributors.length === 1 && noLoss;
    const meaningfulIssues = issues.filter((issue) => !ordinaryFile || !issue.startsWith("This folder"));
    if (contributors.length === 1 && noLoss && !decision && !meaningfulIssues.length) continue;
    const contexts = new Set(contributors.map((item) => normalize(item.context)));
    const orders = contributors.map((item) =>
      item.fieldOrder
        .filter((key) => contributors.every((other) => other.fieldOrder.includes(key)))
        .join("\u0000")
    );
    const fieldsSupported =
      (kind === "definition" || kind === "event") &&
      contexts.size === 1 &&
      new Set(orders).size === 1 &&
      contributors.every((item) => item.fieldsSupported);
    const fingerprint = await hashPatchText(
      JSON.stringify({
        revision: policy.revision,
        order: contributors.map((item) => item.sourceId),
        replace: affectedReplace,
        contributors: contributors.map((item) => ({
          id: item.id,
          text: item.text,
          context: item.context,
          active: item.active,
          priority: item.priority,
        })),
        winner: selection.winner,
      })
    );
    const same = contributors.every(
      (item) =>
        normalize(item.text) === normalize(contributors[0].text) &&
        normalize(item.context) === normalize(contributors[0].context)
    );
    const state: PatchEntry["state"] = decision
      ? decision.fingerprint === fingerprint
        ? "ready"
        : "changed"
      : same && noLoss && !meaningfulIssues.length
        ? "identical"
        : meaningfulIssues.length
          ? "unsupported"
          : "needs-decision";
    const suppressed = contributors.filter((item) => !item.active).length;
    const winner = affectedReplace.length ? undefined : selection.winner;
    const allowedModes: PatchResolution["mode"][] = ["defer"];
    if (winner || !noLoss) allowedModes.push("winner");
    const selectedWinner = contributors.find((item) => item.id === winner);
    const canWrite =
      !affectedReplace.length &&
      !(kind === "file" && filePrecedence(contributors[0].path, policy) === "first") &&
      !(kind === "localization" && selectedWinner?.path.split("/").includes("replace")) &&
      !(kind === "definition" && !winner && noLoss) &&
      !issues.some(
        (issue) =>
          issue.includes("not one safe literal integer") ||
          issue.includes("namespace") ||
          issue.startsWith("Repeated event IDs")
      );
    if (canWrite) {
      allowedModes.push("manual");
      if (!issues.some((issue) => issue.startsWith("Malformed"))) allowedModes.push("source");
      if (fieldsSupported) allowedModes.push("fields");
    }
    entries.push({
      id,
      name,
      kind,
      contributors,
      winner,
      fingerprint,
      state,
      fieldsSupported,
      fieldKeys: [...new Set(contributors.flatMap((item) => item.fieldOrder))],
      issues,
      explanation: `${suppressed} contribution(s) suppressed by whole-file shadowing. ${!noLoss ? "This definition disappeared from the effective files; restoration requires an explicit source choice." : selection.winner ? `Effective contribution: ${contributors.find((item) => item.id === selection.winner)!.sourceName}.` : "No proven effective definition winner."}${kind === "event" && contributors.filter((item) => item.active).length > 1 ? " Choosing another source removes duplicate IDs from other effective files while preserving their siblings." : ""}`,
      ...(decision ? { decision } : {}),
      allowedModes,
    });
  }
  for (const [id, decision] of Object.entries(project.decisions))
    if (!scanned.entries.has(id)) {
      const fingerprint = await hashPatchText(JSON.stringify({ revision: policy.revision, absent: id }));
      entries.push({
        id,
        name: id,
        kind: "file",
        contributors: [],
        explanation: "All upstream contributions disappeared. Confirm follow winner to retire this output.",
        fingerprint,
        state: decision.fingerprint === fingerprint ? "ready" : "changed",
        fieldKeys: [],
        fieldsSupported: false,
        issues: [],
        decision,
        allowedModes: ["winner", "defer"],
      });
    }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return {
    entries,
    issues: scanned.issues,
    sourceCount: snapshot.sources.length,
    fileCount: snapshot.sources.reduce((count, source) => count + source.files.length, 0),
    snapshot,
    policy,
  };
}

function contribution(entry: PatchEntry, id: string | undefined): Contribution {
  const item = entry.contributors.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown contribution for ${entry.name}`);
  return item as Contribution;
}

function resolvedText(
  entry: PatchEntry,
  resolution: PatchResolution
): { text?: string; selected?: Contribution } {
  if (resolution.mode === "defer") return {};
  if (resolution.mode === "winner")
    return entry.winner
      ? { selected: contribution(entry, entry.winner), text: contribution(entry, entry.winner).text }
      : {};
  if (resolution.mode === "source") {
    const selected = contribution(entry, resolution.contributorId);
    return { text: selected.text, selected };
  }
  if (resolution.mode === "manual") {
    const selected = entry.winner
      ? contribution(entry, entry.winner)
      : (entry.contributors[0] as Contribution | undefined);
    return { text: resolution.text, selected };
  }
  if (!entry.fieldsSupported)
    throw new Error("Field combination requires compatible file context and indivisible ordered groups");
  const choices = resolution.fields!;
  if (
    Object.keys(choices).length !== entry.fieldKeys.length ||
    entry.fieldKeys.some((key) => !Object.hasOwn(choices, key))
  )
    throw new Error("Every direct field group requires an explicit choice, including omitted groups");
  for (const [key, id] of Object.entries(choices)) {
    if (!entry.fieldKeys.includes(key)) throw new Error(`Unknown direct field: ${key}`);
    if (id !== null && !Object.hasOwn(contribution(entry, id).fields, key))
      throw new Error(`Selected contribution has no field: ${key}`);
  }
  const selected = entry.winner
    ? contribution(entry, entry.winner)
    : contribution(entry, entry.contributors[0]?.id);
  const parsed = assignments(parseScript(selected.text).root.statements)[0];
  if (parsed?.value?.kind !== "block") throw new Error("Field combination requires a block definition");
  const order = [...new Set([...(selected.fieldOrder ?? []), ...entry.fieldKeys])];
  const body = order
    .filter((key) => choices[key] !== null)
    .map((key) => contribution(entry, choices[key]!).fields[key])
    .join("");
  return { selected, text: `${selected.text.slice(0, parsed.value.openBrace + 1)}${body}\n}` };
}

function validateResolution(entry: PatchEntry, resolution: PatchResolution): void {
  parsePatchResolution(resolution);
  if (resolution.mode === "winner" && !entry.winner && entry.contributors.some((item) => item.active))
    throw new Error("There is no verified effective winner for this entry");
  const answer = resolvedText(entry, resolution);
  if (resolution.mode === "manual") {
    if (entry.kind === "localization") {
      const key = /^\s*([A-Za-z0-9_.\-']+):\d*\s+".*"[^\r\n]*$/u.exec(answer.text ?? "");
      if (key?.[1] !== entry.name)
        throw new Error("Manual localization must contain exactly the selected key");
    } else {
      if (entry.kind === "file" && entry.name.endsWith(".yml")) {
        const parsed = parseLoc(answer.text ?? "");
        if (parsed.errors.length || !parsed.language || !entry.name.endsWith(`_l_${parsed.language}.yml`))
          throw new Error("Manual localization file requires a valid language header and matching filename");
        return;
      }
      const parsed = parseScript(answer.text ?? "");
      if (parsed.errors.length) throw new Error("Manual script contains structural errors");
      if (entry.kind !== "file") {
        const nodes = assignments(parsed.root.statements);
        if (nodes.length !== 1 || parsed.root.statements.length !== 1 || nodes[0].key.text !== entry.name)
          throw new Error("Manual text must contain exactly the selected definition");
      }
    }
  }
}

export async function resolvePatchEntry(
  analysis: PatchAnalysis,
  project: PatchProject,
  entryId: string,
  resolution: PatchResolution
): Promise<PatchProject> {
  parsePatchProject(project, analysis.snapshot.gameId);
  const current = await analyzePatch(analysis.snapshot, project, analysis.policy);
  const entry = current.entries.find((item) => item.id === entryId);
  if (!entry) throw new Error("Unknown patch entry");
  if (analysis.entries.find((item) => item.id === entryId)?.fingerprint !== entry.fingerprint)
    throw new Error("Patch entry analysis is stale for this project input order");
  validateResolution(entry, resolution);
  return {
    ...project,
    decisions: {
      ...project.decisions,
      [entryId]: {
        ...(project.decisions[entryId] ?? {}),
        fingerprint: entry.fingerprint,
        resolution: JSON.parse(JSON.stringify(resolution)) as PatchResolution,
      },
    },
  };
}

function addContext(text: string, context: string, policy: PatchPolicy): string {
  const roots = assignments(parseScript(text).root.statements);
  const needed = assignments(parseScript(context).root.statements);
  const additions: string[] = [];
  for (const item of needed) {
    const matching = roots.filter((root) => root.key.text === item.key.text);
    const exact = matching.some(
      (root) =>
        normalize(text.slice(root.range.start, root.range.end)) ===
        normalize(context.slice(item.range.start, item.range.end))
    );
    if (exact) continue;
    if (matching.length && item.key.text !== policy.eventRules?.namespaceKey)
      throw new Error(`Selected file context conflicts with baseline declaration ${item.key.text}`);
    additions.push(context.slice(item.range.start, item.range.end));
  }
  return additions.length ? `${additions.join("\n")}\n${text.replace(/^\uFEFF/u, "")}` : text;
}

function eventFile(text: string, policy: PatchPolicy): string {
  if (!policy.eventRules) throw new Error("Event composition has no verified namespace rule");
  const roots = assignments(parseScript(text).root.statements);
  const declarations = roots.filter((node) => node.key.text === policy.eventRules!.namespaceKey);
  const namespaces = declarations.flatMap((node) => (node.value?.kind === "scalar" ? [node.value.text] : []));
  for (const node of roots.filter((item) => !declaration(item, policy))) {
    if (
      node.value?.kind !== "block" ||
      !namespaces.some((namespace) => node.key.text.startsWith(`${namespace}.`))
    )
      throw new Error("Generated event IDs require a declared namespace and a block definition");
  }
  const prefix = declarations.map((node) => text.slice(node.range.start, node.range.end)).join("\n");
  if (prefix && text.replace(/^\uFEFF/u, "").startsWith(prefix)) return text;
  for (const node of [...declarations].reverse())
    text = text.slice(0, node.range.start) + text.slice(node.range.end);
  // The engine requires declarations before event content, even when a donor adds local constants.
  return `${prefix}\n${text.replace(/^\uFEFF/u, "")}`;
}

/** Reapply writer contracts after merging current manual output with generated text. */
export function normalizePatchFile(path: string, text: string, policy: PatchPolicy): string {
  validatePatchPath(path);
  if (within(path, policy.localizationFolder) && path.endsWith(".yml")) {
    const parsed = parseLoc(text);
    if (parsed.errors.length || !parsed.language || !path.endsWith(`_l_${parsed.language}.yml`))
      throw new Error("Merged localization requires a valid language header, entries and matching filename");
  } else if (/\.(txt|gui|asset|gfx)$/u.test(path) && parseScript(text).errors.length)
    throw new Error("Merged output contains script structure errors");
  if (policy.scriptFolders.some((folder) => folder.kind === "event" && within(path, folder.path)))
    text = eventFile(text, policy);
  return /\.(txt|yml)$/u.test(path) ? bom(text) : text;
}

/** Desired output is the complete owned set. Missing old paths are maintenance removals. */
export async function generatePatch(
  analysis: PatchAnalysis,
  project: PatchProject
): Promise<PatchDesiredOutput> {
  parsePatchProject(project, analysis.snapshot.gameId);
  const current = await analyzePatch(analysis.snapshot, project, analysis.policy);
  if (
    current.entries.length !== analysis.entries.length ||
    current.entries.some(
      (entry) => analysis.entries.find((old) => old.id === entry.id)?.fingerprint !== entry.fingerprint
    )
  )
    throw new Error("Analysis is stale for this project input order");
  // Source coverage notices stay visible in analysis. Only unresolved intent or unsafe writes block output.
  const issues: string[] = [];
  const scanned = inventory(current.snapshot, project, current.policy);
  const edits = new Map<
    string,
    { start: number; end: number; text: string; entry: string; context: string }[]
  >();
  const files = new Map<string, PatchDesiredFile>();
  const addEdit = (path: string, start: number, end: number, text: string, entry: string, context = "") => {
    const list = edits.get(path) ?? [];
    list.push({ start, end, text, entry, context });
    edits.set(path, list);
  };
  for (const entry of current.entries) {
    const decision = Object.hasOwn(project.decisions, entry.id) ? project.decisions[entry.id] : undefined;
    if (!decision) {
      if (entry.state !== "identical") issues.push(`${entry.name}: resolution is required (${entry.state}).`);
      continue;
    }
    if (decision.fingerprint !== entry.fingerprint) {
      issues.push(`${entry.name}: saved intent requires review after input changes.`);
      continue;
    }
    try {
      const resolution = decision.resolution;
      validateResolution(entry, resolution);
      if (resolution.mode === "defer") continue;
      if (resolution.mode === "winner") continue;
      if (entry.issues.some((issue) => issue.startsWith("replace_path")))
        throw new Error("replace_path suppression requires verified evidence before writing");
      const { text, selected } = resolvedText(entry, resolution);
      if (text === undefined || !selected) throw new Error("No upstream file remains for this resolution");
      const winner = entry.winner ? contribution(entry, entry.winner) : undefined;
      if (
        winner &&
        normalize(text) === normalize(winner.text) &&
        normalize(selected.context) === normalize(winner.context)
      )
        continue;
      if (entry.kind === "localization") {
        if (winner?.path.split("/").includes("replace"))
          throw new Error(
            "An existing replace localization entry wins before this patch; change launcher order or use a verified override rule"
          );
        const language = selected.language!;
        const path = suggestLocalizationTarget({
          key: entry.name,
          language,
          documents: [],
          locRoots: [current.policy.localizationFolder],
          sourcePath: selected.path,
          override: true,
        }).path;
        const existing = files.get(path);
        files.set(path, {
          path,
          text: existing ? `${existing.text}\n${text}` : `\uFEFFl_${language}:\n${text}\n`,
          entries: [...(existing?.entries ?? []), entry.id],
          localization: {
            language,
            keys: [...(existing?.localization?.keys ?? []), entry.name],
            override: true,
            sourcePath: selected.path,
          },
        });
        continue;
      }
      if (entry.kind === "file") {
        if (filePrecedence(selected.path, current.policy) === "first")
          throw new Error("A patch loaded last cannot replace a first-in-wins file");
        addEdit(selected.path, 0, scanned.effective.get(selected.path)!.file.text.length, text, entry.id);
        continue;
      }
      if (!winner && entry.kind !== "event" && entry.contributors.some((item) => item.active))
        throw new Error("Cross-file duplicates require a verified winner before automatic definition output");
      if (
        entry.issues.some(
          (issue) => issue.includes("not one safe literal integer") || issue.includes("namespace")
        )
      )
        throw new Error("Event identity or priority requires a complete validated manual file");
      const destination = winner?.path ?? selected.path;
      const baseline = scanned.effective.get(destination)!;
      const nodes = assignments(parseScript(baseline.file.text).root.statements).filter(
        (node) => node.key.text === entry.name
      );
      if (nodes.length > 1) throw new Error("Repeated top-level definitions require a complete manual file");
      addEdit(
        destination,
        nodes[0]?.range.start ?? baseline.file.text.length,
        nodes[0]?.range.end ?? baseline.file.text.length,
        nodes.length ? text : `\n${text}\n`,
        entry.id,
        selected.context
      );
      if (entry.kind === "event")
        for (const item of entry.contributors.filter(
          (candidate) => candidate.active && candidate.path !== destination
        )) {
          const original = item as Contribution;
          addEdit(item.path, original.start, original.end, "", entry.id);
        }
    } catch (error) {
      issues.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const [path, changes] of edits) {
    try {
      const original = scanned.effective.get(path)!.file.text;
      changes.sort((a, b) => b.start - a.start || b.end - a.end);
      for (let index = 1; index < changes.length; index++)
        if (changes[index].end > changes[index - 1].start)
          throw new Error("Overlapping file and definition resolutions require one coherent manual choice");
      let text = original;
      for (const change of changes) text = text.slice(0, change.start) + change.text + text.slice(change.end);
      for (const change of changes) text = addContext(text, change.context, current.policy);
      if (path.endsWith(".yml") && within(path, current.policy.localizationFolder)) {
        const parsed = parseLoc(text);
        if (parsed.errors.length || !parsed.language || !path.endsWith(`_l_${parsed.language}.yml`))
          throw new Error(
            "Generated localization file requires a valid language header and matching filename"
          );
      } else if (parseScript(text).errors.length)
        throw new Error("Generated script contains structural errors");
      if (normalize(text) === normalize(original)) continue;
      if (current.policy.scriptFolders.some((folder) => folder.kind === "event" && within(path, folder.path)))
        text = eventFile(text, current.policy);
      files.set(path, {
        path,
        text: bom(text),
        entries: [...new Set(changes.map((change) => change.entry))],
      });
    } catch (error) {
      issues.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const deferred = new Set(
    current.entries
      .filter(
        (entry) =>
          project.decisions[entry.id]?.fingerprint === entry.fingerprint &&
          project.decisions[entry.id]?.resolution.mode === "defer"
      )
      .map((entry) => entry.id)
  );
  for (const [path, generated] of Object.entries(project.generated))
    if (generated.entries.some((id) => deferred.has(id))) {
      const next = files.get(path);
      if (next && next.text !== generated.text)
        issues.push(
          `${path}: deferred manual work shares this owned file; resolve its file ownership before replacing it.`
        );
      else files.set(path, { path, text: generated.text, entries: generated.entries });
    }
  // A partial desired set would cause the host to prune still-needed owned files.
  return {
    files: issues.length ? [] : [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    issues,
  };
}
