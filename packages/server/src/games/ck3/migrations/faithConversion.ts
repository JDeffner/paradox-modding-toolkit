import type { MigrationQuestion } from "@px-lsp/protocol/migration";
import type { AssignmentNode } from "../../../parser/cst";
import { LineIndex } from "../../../parser/cst";
import { tokenize } from "../../../parser/lexer";
import type {
  MigrationAnswers,
  MigrationContext,
  MigrationFinding,
  MigrationInspection,
  MigrationProposal,
  MigrationRoot,
  MigrationTextEdit,
  MigrationChange,
} from "../../../migrations/sdk";
import {
  assignments,
  children,
  field,
  scalar,
  pieces,
  equivalent,
  renamePiece,
  editText,
  resolveFileConstants,
  unresolvedFileConstants,
  type Piece,
} from "./faithSyntax";
import { convertFaithConsumers } from "./faithConsumers";
import { convertCustomTenets, removeConvertedTenetGroups } from "./faithTenets";
import { rebaseFaith } from "./faithRebase";

export const RELIGIONS = "common/religion/religion_types";
export const FAITHS = "common/religion/faith_types";
export const RITES = "common/religion/rite_types";
export const DOCTRINES = "common/religion/doctrine_types";
export const TENETS = "common/religion/tenet_types";
export interface Definition {
  id: string;
  path: string;
  text: string;
  node: AssignmentNode;
  religion?: Definition;
}
export interface FaithWork {
  context: MigrationContext;
  answers: Readonly<MigrationAnswers>;
  parse: typeof import("../../../parser/parser").parseScript;
  findings: MigrationFinding[];
  questions: MigrationQuestion[];
  edits: Map<string, MigrationTextEdit[]>;
  creates: Map<string, string>;
  binaryCreates: Map<string, Uint8Array>;
  ask(
    id: string,
    label: string,
    options: { value: string; label: string }[],
    description?: string
  ): string | undefined;
  fail(id: string, message: string, def?: Pick<Definition, "path">, offset?: number): void;
  addEdit(path: string, edit: MigrationTextEdit): void;
}
function rootDefinitions(w: FaithWork, root: MigrationRoot, prefix: string): Definition[] {
  const result: Definition[] = [];
  for (const path of w.context
    .list(root, prefix)
    .filter((p) => p.endsWith(".txt"))
    .sort()) {
    const text = w.context.readText(root, path);
    if (text === undefined) {
      w.fail(`unreadable:${root}:${path}`, `Cannot read ${root} input; restore it and refresh the preview.`, {
        path,
      });
      continue;
    }
    const parsed = w.parse(text);
    if (parsed.errors.length) {
      w.fail(
        `syntax:${root}:${path}`,
        `Repair structural parse errors in this ${root} input before conversion.`,
        { path }
      );
      continue;
    }
    for (const node of assignments(parsed.root.statements))
      if (node.value?.kind === "block") result.push({ id: node.key.text, path, text, node });
  }
  return result;
}
function unique(w: FaithWork, defs: Definition[], root: string): Map<string, Definition> {
  const out = new Map<string, Definition>();
  const duplicates = new Set<string>();
  for (const def of defs) {
    if (out.has(def.id)) {
      duplicates.add(def.id);
      w.fail(
        `duplicate:${root}:${def.id}`,
        `Multiple ${root} definitions of ${def.id}; resolve the load-order ambiguity before conversion.`,
        def
      );
    } else out.set(def.id, def);
  }
  for (const id of duplicates) out.delete(id);
  return out;
}
function schema(w: FaithWork, path: string): AssignmentNode | undefined {
  const text = w.context.readText("target", path);
  return text === undefined
    ? undefined
    : assignments(w.parse(text).root.statements).find((n) => n.value?.kind === "block");
}
function rawValue(p: Piece): string {
  return p.node.value ? resolveFileConstants(p.text, p.node.value.range.start, p.node.value.range.end) : "";
}
function commentText(text: string, w: FaithWork): string {
  return w
    .parse(text)
    .comments.map((c) => c.text + "\n")
    .join("");
}
function collectIds(defs: Definition[]): Set<string> {
  const ids = new Set<string>();
  for (const d of defs) {
    ids.add(d.id);
    for (const c of children(d.node)) if (c.value?.kind === "block") ids.add(c.key.text);
  }
  return ids;
}
function flattenReligion(def: Definition, _details: Set<string>): Piece[] {
  return pieces(def.node, def.text).fields.flatMap((p) =>
    p.key === "faiths"
      ? []
      : p.key === "religion_details"
        ? pieces(p.node, p.text).fields
        : p.key === "doctrine_background_icon"
          ? [renamePiece(p, "tenet_background_icon")]
          : [p]
  );
}
function mergeReligion(
  w: FaithWork,
  mod: Definition,
  source: Definition | undefined,
  target: Definition | undefined,
  details: Set<string>
): Piece[] {
  const mine = flattenReligion(mod, details);
  if (!source && !target) return mine;
  if (!source || !target) {
    w.fail(
      `religion-baseline:${mod.id}`,
      `Religion ${mod.id} exists in only one reference version. Supply both definitions or resolve its upstream removal/creation manually.`,
      mod
    );
    return mine;
  }
  const old = flattenReligion(source, details),
    next = flattenReligion(target, details);
  const result: Piece[] = [];
  for (const key of new Set([...next, ...mine, ...old].map((p) => p.key))) {
    const b = old.filter((p) => p.key === key),
      m = mine.filter((p) => p.key === key),
      t = next.filter((p) => p.key === key);
    if (equivalent(m, b)) result.push(...t);
    else if (equivalent(t, b) || equivalent(m, t)) result.push(...m);
    else {
      const choice = w.ask(
        `religion:${mod.id}:conflict:${key}`,
        `Resolve ${mod.id}.${key}`,
        [
          { value: "mod", label: "Keep the mod value (including removal)" },
          { value: "target", label: "Use the target game value" },
        ],
        "Both the mod and target changed this field since the source version. All unchanged fields retain target updates."
      );
      result.push(...(choice === "target" ? t : m));
    }
  }
  return result;
}
function renderReligion(id: string, fields: Piece[], details: Set<string>, tail: string): string {
  return `${id} = {\n\treligion_details = {${fields
    .filter((p) => details.has(p.key))
    .map((p) => p.raw)
    .join("")}\n\t}${fields
    .filter((p) => !details.has(p.key))
    .map((p) => p.raw)
    .join("")}${tail}\n}`;
}
/** Crozier requires this term; its value comes from captured target religion localization. */
function supplyFemaleHeadTitle(
  w: FaithWork,
  def: Definition,
  text: string,
  targetReligions: Map<string, Definition>
): string {
  const localization = field(assignments(w.parse(text).root.statements)[0], "localization");
  const terms = children(localization);
  const heads = terms.filter((node) => node.key.text === "ReligiousHeadName");
  if (!heads.length || terms.some((node) => node.key.text === "ReligiousHeadNameFemale")) return text;
  const literal = (node: AssignmentNode | undefined): string | undefined => {
    const value = scalar(node);
    return value && !value.startsWith("@") && !value.includes("$") ? value : undefined;
  };
  const head = heads.length === 1 ? literal(heads[0]) : undefined;
  const candidates = new Map<string | undefined, string | undefined>();
  if (head)
    for (const target of targetReligions.values()) {
      const targetTerms = children(field(target.node, "localization"));
      const targetHeads = targetTerms.filter((node) => node.key.text === "ReligiousHeadName");
      if (!targetHeads.some((node) => literal(node) === head)) continue;
      const female = targetTerms.filter((node) => node.key.text === "ReligiousHeadNameFemale");
      const key = targetHeads.length === 1 && female.length === 1 ? literal(female[0]) : undefined;
      if (!candidates.has(key))
        candidates.set(
          key,
          key ? target.text.slice(female[0].value!.range.start, female[0].value!.range.end) : undefined
        );
    }
  const value = [...candidates.values()][0];
  if (candidates.size !== 1 || value === undefined) {
    w.fail(
      `religious-head-female:${def.religion ? "faith" : "religion"}:${def.id}`,
      `Cannot derive ${def.id}.ReligiousHeadNameFemale from one complete captured target religion mapping. Add an explicit ReligiousHeadNameFemale localization assignment and refresh the preview.`,
      def,
      field(def.node, "localization")?.range.start ?? def.node.range.start
    );
    return text;
  }
  const block = localization!.value;
  if (block?.kind !== "block" || block.closeBrace === null) {
    w.fail(
      `religious-head-localization:${def.id}`,
      "Repair the localization block before adding the required female head title.",
      def,
      def.node.range.start
    );
    return text;
  }
  const lineStart = text.lastIndexOf("\n", block.closeBrace - 1) + 1;
  const indent = text.slice(lineStart, block.closeBrace);
  const closingLine = /^[\t ]*$/.test(indent);
  const at = closingLine ? lineStart : block.closeBrace;
  return editText(text, [
    {
      start: at,
      end: at,
      text: closingLine
        ? `${indent}\tReligiousHeadNameFemale = ${value}\n`
        : `\n\t\tReligiousHeadNameFemale = ${value}\n\t`,
    },
  ]);
}
export async function buildFaithMigration(
  context: MigrationContext,
  answers: Readonly<MigrationAnswers>,
  coverage: string[]
): Promise<{ inspection: MigrationInspection; proposal: MigrationProposal }> {
  const { parseScript } = await import("../../../parser/parser");
  const parse: typeof parseScript = (text) => {
    const result = parseScript(text);
    // The tolerant parser's last-resort guard returns an empty tree. That is not writer validation.
    if (
      !result.root.statements.length &&
      !result.errors.length &&
      tokenize(text).some((token) => token.kind !== "comment" && token.kind !== "eof")
    )
      result.errors.push({
        code: "missing-value",
        message: "Parser could not inspect this nonempty input.",
        range: { start: 0, end: text.length },
      });
    return result;
  };
  const w: FaithWork = {
    context,
    answers,
    parse,
    findings: [],
    questions: [],
    edits: new Map(),
    creates: new Map(),
    binaryCreates: new Map(),
    ask(id, label, options, description) {
      if (!this.questions.some((q) => q.id === id))
        this.questions.push({
          id,
          label,
          description,
          kind: "choice",
          required: true,
          options,
          group: id.startsWith("reference:")
            ? id.slice(10, id.lastIndexOf(":"))
            : id.split(":").slice(0, 2).join(":"),
        });
      const value = Object.hasOwn(answers, id) ? answers[id] : undefined;
      return typeof value === "string" && options.some((o) => o.value === value) ? value : undefined;
    },
    fail(id, message, def, offset) {
      if (this.findings.some((f) => f.id === id)) return;
      const text = def ? context.readText("mod", def.path) : undefined;
      this.findings.push({
        id,
        severity: "error",
        message,
        ...(def ? { path: def.path } : {}),
        ...(text !== undefined && offset !== undefined
          ? { line: new LineIndex(text).positionAt(offset).line + 1 }
          : {}),
      });
    },
    addEdit(path, edit) {
      const edits = this.edits.get(path) ?? [];
      edits.push(edit);
      this.edits.set(path, edits);
    },
  };
  const religions = rootDefinitions(w, "mod", RELIGIONS);
  const nested = religions.flatMap((religion) =>
    children(religion.node)
      .filter((n) => n.key.text === "faiths")
      .flatMap((n) => children(n).map((node) => ({ ...religion, id: node.key.text, node, religion })))
  );
  const old = unique(w, nested, "mod");
  const finish = (
    applicability: MigrationInspection["applicability"]
  ): { inspection: MigrationInspection; proposal: MigrationProposal } => {
    const missing = w.questions
      .filter((q) => !Object.hasOwn(answers, q.id) || !q.options?.some((o) => o.value === answers[q.id]))
      .map((q) => ({ id: `answer:${q.id}`, severity: "error" as const, message: `Choose: ${q.label}` }));
    const unresolved = [...w.findings.filter((f) => f.severity === "error"), ...missing];
    const changes: MigrationChange[] = [];
    if (!unresolved.length) {
      for (const [path, edits] of w.edits) {
        const text = context.readText("mod", path)!;
        const sorted = [...edits].sort((a, b) => a.start - b.start);
        if (sorted.some((e, i) => i > 0 && e.start < sorted[i - 1].end)) {
          w.fail(`overlap:${path}`, "Coordinated edits overlap. Resolve this file manually.", { path });
          continue;
        }
        const after = editText(text, edits);
        if (parse(after).errors.length) {
          w.fail(`output-syntax:${path}`, "Generated file failed structural validation.", { path });
          continue;
        }
        if (after !== text) {
          const withBom = edits.map((edit) => ({ ...edit }));
          if (!after.startsWith("\uFEFF")) {
            const first = withBom.find((edit) => edit.start === 0);
            if (first) first.text = "\uFEFF" + first.text;
            else withBom.push({ start: 0, end: 0, text: "\uFEFF" });
          }
          changes.push({
            kind: "text",
            path,
            edits: withBom,
          });
        }
      }
      for (const [path, text] of w.creates) {
        const constants = unresolvedFileConstants(text);
        if (constants.length) {
          w.fail(
            `unresolved-constants:${path}`,
            `Cannot preserve file-local bindings ${constants.join(", ")}. Resolve unsupported, ambiguous or unavailable constants before moving this definition.`,
            { path }
          );
          continue;
        }
        if (context.readBytes("mod", path) !== undefined) {
          w.fail(
            `output-collision:${path}`,
            "Output path already exists. Rename it or merge it manually before conversion.",
            { path }
          );
          continue;
        }
        if (parse(text).errors.length) {
          w.fail(`output-syntax:${path}`, "Generated file failed structural validation.", { path });
          continue;
        }
        changes.push({ kind: "create", path, bytes: new TextEncoder().encode("\uFEFF" + text) });
      }
      for (const [path, bytes] of w.binaryCreates) {
        if (context.fileInfo("mod", path))
          w.fail(
            `output-collision:${path}`,
            "The converted icon path already exists. Keep or merge the existing asset before conversion.",
            { path }
          );
        else changes.push({ kind: "create", path, bytes });
      }
    }
    const all = [...w.findings.filter((f) => f.severity === "error"), ...missing];
    return {
      inspection: { applicability, findings: w.findings, questions: w.questions, coverage: [...coverage] },
      proposal: {
        groups:
          all.length || !changes.length
            ? []
            : [
                {
                  id: "faith-conversion",
                  title: "Convert religious definitions and consumers together",
                  dependsOn: [],
                  changes,
                },
              ],
        unresolved: all,
        checks: [
          {
            id: "faith-structure",
            label: "Captured schemas and generated script structure",
            stage: "before-apply",
            necessity: "required",
            status: all.length ? "failed" : "passed",
          },
          {
            id: "faith-target-game",
            label: "Target game and all supported bookmarks",
            stage: "after-apply",
            necessity: "advisory",
            status: "not-run",
            detail:
              "Check effective tenets, doctrines, sites, heads, assignments and existing saves separately. An older validator does not validate this target schema.",
          },
        ],
      },
    };
  };
  if (!nested.length) {
    w.findings.push({
      id: "no-nested-faiths",
      severity: "info",
      message: "No nested faith definitions detected. This does not establish compatibility.",
    });
    return finish(w.findings.some((f) => f.severity === "error") ? "unknown" : "not-applicable");
  }
  const faithSchema = schema(w, `${FAITHS}/_faith_types.info`),
    riteSchema = schema(w, `${RITES}/_rite_types.info`),
    religionSchema = schema(w, `${RELIGIONS}/_religion_types.info`);
  if (
    !faithSchema ||
    !riteSchema ||
    !religionSchema ||
    !field(faithSchema, "faith_details") ||
    !field(riteSchema, "faith") ||
    !field(religionSchema, "religion_details")
  ) {
    w.fail(
      "target-schema-unconfirmed",
      "Capture complete target faith, rite and religion documentation before conversion."
    );
    return finish("unknown");
  }
  if (!context.readText("source", `${RELIGIONS}/_religion_types.info`))
    w.fail("source-schema-missing", "Capture the source religion documentation before conversion.");
  const details = new Set(children(field(faithSchema, "faith_details")!).map((n) => n.key.text));
  const religionDetails = new Set(
    children(field(religionSchema, "religion_details")!).map((n) => n.key.text)
  );
  const faithKeys = new Set(children(faithSchema).map((n) => n.key.text));
  const riteKeys = new Set(children(riteSchema).map((n) => n.key.text));
  const targetFaiths = unique(w, rootDefinitions(w, "target", FAITHS), "target");
  const modFaiths = unique(w, rootDefinitions(w, "mod", FAITHS), "mod-faith");
  const targetRites = unique(w, rootDefinitions(w, "target", RITES), "target-rite");
  const modRites = unique(w, rootDefinitions(w, "mod", RITES), "mod-rite");
  const sourceRel = unique(w, rootDefinitions(w, "source", RELIGIONS), "source-religion"),
    targetRel = unique(w, rootDefinitions(w, "target", RELIGIONS), "target-religion");
  const targetTenets = rootDefinitions(w, "target", TENETS),
    modTenets = rootDefinitions(w, "mod", TENETS);
  const tenets = collectIds([...targetTenets, ...modTenets]);
  const modDoctrineRoots = rootDefinitions(w, "mod", DOCTRINES);
  const usedDoctrineIds = new Set(
    nested.flatMap((def) =>
      children(def.node)
        .filter((node) => node.key.text === "doctrine")
        .map(scalar)
    )
  );
  const modDoctrineDefs = modDoctrineRoots.flatMap((def) => [
    def,
    ...children(def.node)
      .filter((node) => node.value?.kind === "block" && usedDoctrineIds.has(node.key.text))
      .map((node) => ({ ...def, id: node.key.text, node })),
  ]);
  const doctrines = collectIds([...rootDefinitions(w, "target", DOCTRINES), ...modDoctrineDefs]);
  const representations = new Map<string, string>();
  for (const [id, def] of old) {
    if (!/^[A-Za-z0-9_.-]+$/.test(id))
      w.fail(
        `unsafe-id:${id}`,
        "Rename this definition to a literal database identifier before conversion.",
        def
      );
    const choice = w.ask(`faith:${id}:representation`, `How should ${id} be represented?`, [
      { value: "independent", label: "Keep as an independent faith" },
      { value: "rite", label: "Make a rite under a selected faith" },
      { value: "defer", label: "Defer conversion" },
    ]);
    if (choice) representations.set(id, choice);
    if (choice === "defer")
      w.fail(
        `deferred-faith:${id}`,
        `Conversion of ${id} is deferred. Choose a representation before applying this coordinated change.`,
        def
      );
    w.findings.push({
      id: `nested-faith:${id}`,
      severity: "info",
      path: def.path,
      line: new LineIndex(def.text).positionAt(def.node.range.start).line + 1,
      message: `Nested faith ${id} will retain its ID in the selected database.`,
    });
  }
  const parents = new Map<string, string>();
  for (const [id, def] of old)
    if (representations.get(id) === "rite") {
      const candidates = [
        ...new Set([
          ...targetFaiths.keys(),
          ...modFaiths.keys(),
          ...[...representations].filter(([, v]) => v === "independent").map(([k]) => k),
        ]),
      ]
        .filter((k) => k !== id)
        .sort();
      if (!candidates.length)
        w.fail(
          `missing-parent-faith:${id}`,
          "Choose another old community as an independent faith or capture an existing parent faith.",
          def
        );
      else {
        const parent = w.ask(
          `faith:${id}:parent`,
          `Parent faith for ${id}`,
          candidates.map((value) => ({ value, label: value }))
        );
        if (parent) parents.set(id, parent);
      }
    }
  const convertedRel = new Map<string, Piece[]>();
  for (const religion of religions.filter((r) => field(r.node, "faiths")))
    convertedRel.set(
      religion.id,
      mergeReligion(w, religion, sourceRel.get(religion.id), targetRel.get(religion.id), religionDetails)
    );
  const customIds = new Set<string>();
  for (const def of modDoctrineDefs)
    if (!tenets.has(def.id)) {
      // Custom doctrine files have no reliable ID prefix contract. Ask only for definitions used by this conversion.
      if (
        !nested.some((d) => children(d.node).some((n) => n.key.text === "doctrine" && scalar(n) === def.id))
      )
        continue;
      const kind = w.ask(
        `doctrine:${def.id}:database`,
        `Database for custom ${def.id}`,
        [
          { value: "doctrine", label: "Doctrine" },
          { value: "tenet", label: "Core tenet" },
        ],
        "Classify this custom definition. Vanilla IDs are classified using the captured target databases."
      );
      if (kind === "tenet") {
        tenets.add(def.id);
        doctrines.delete(def.id);
        customIds.add(def.id);
      }
    }
  for (const def of modDoctrineDefs) if (tenets.has(def.id)) customIds.add(def.id);
  convertCustomTenets(
    w,
    modDoctrineDefs.filter((d) => customIds.has(d.id)),
    tenets
  );
  removeConvertedTenetGroups(w, tenets, customIds);
  const output = new Map<
    string,
    { def: Definition; fields: Piece[]; extra: string[]; tail: string; kind: string }
  >();
  for (const [id, def] of old) {
    const kind = representations.get(id);
    if (!kind || kind === "defer") continue;
    if ((kind === "independent" ? modFaiths : modRites).has(id))
      w.fail(
        `id-collision:${id}`,
        `${id} already exists in the destination mod database. Merge these definitions manually.`,
        def
      );
    if ((kind === "independent" ? targetFaiths : targetRites).has(id) && !sourceRel.get(def.religion!.id))
      w.fail(
        `id-collision:${id}`,
        `Custom ${id} collides with a target definition; choose a different ID manually.`,
        def
      );
    if (kind === "independent" && targetRites.has(id) && !targetFaiths.has(id))
      w.fail(
        `id-collision:${id}`,
        `${id} is a target rite. Keeping the same independent-faith ID would also collide with its dynamic main rite.`,
        def
      );
    const original = pieces(def.node, def.text);
    const kept: Piece[] = [];
    const extra: string[] = [];
    const selected: { tenets: Piece[]; doctrines: Piece[] } = { tenets: [], doctrines: [] };
    const sites: { ordinary: Piece[]; eminent: Piece[] } = { ordinary: [], eminent: [] };
    for (const p of original.fields) {
      if (p.key === "doctrine") {
        const key = scalar(p.node);
        if (!key || (!tenets.has(key) && !doctrines.has(key)))
          w.fail(
            `unknown-doctrine:${id}:${key ?? p.node.range.start}`,
            `Cannot classify ${key ?? "dynamic doctrine"} from captured target or mod databases. Capture its dependency definition.`,
            def,
            p.node.range.start
          );
        else selected[tenets.has(key) ? "tenets" : "doctrines"].push(p);
      } else if (p.key === "holy_site") {
        const site = scalar(p.node);
        if (!site) {
          w.fail(
            `dynamic-site:${id}:${p.node.range.start}`,
            "Resolve this dynamic holy-site assignment manually.",
            def,
            p.node.range.start
          );
          continue;
        }
        if (kind === "independent") {
          const role = w.ask(
            `faith:${id}:holy-site:${site}`,
            `Role of ${id}'s holy site ${site}`,
            [
              { value: "ordinary", label: "Ordinary (local bonuses)" },
              { value: "eminent", label: "Eminent (global and local bonuses)" },
            ],
            "Old sites can provide global effects. Target limits apply; a site cannot have both roles."
          );
          if (role) sites[role as keyof typeof sites].push(p);
        } else kept.push(p);
      } else if (p.key === "doctrine_selection_pair") {
        const pair = children(p.node);
        const entries = pair.filter((n) => n.key.text === "doctrine" || n.key.text === "fallback_doctrine");
        if (entries.some((n) => !tenets.has(scalar(n) ?? "")))
          w.fail(
            `pair:${id}:${p.node.range.start}`,
            "DLC selection contains a non-tenet or unknown definition. Resolve the target representation manually.",
            def,
            p.node.range.start
          );
        const raw = def.text.slice(p.node.range.start, p.node.range.end);
        const edits = [
          { start: 0, end: p.node.key.range.end - p.node.range.start, text: "tenet_selection_pair" },
          ...entries.map((n) => ({
            start: n.key.range.start - p.node.range.start,
            end: n.key.range.end - p.node.range.start,
            text: n.key.text === "doctrine" ? "tenet" : "fallback_tenet",
          })),
        ];
        extra.push("\n" + commentText(p.raw.slice(0, p.raw.length - raw.length), w) + editText(raw, edits));
      } else kept.push(p);
    }
    for (const key of ["tenets", "doctrines"] as const)
      if (selected[key].length)
        extra.push(
          `\n\t${key} = {${selected[key]
            .map((p) => {
              const at = p.leadingLength;
              return p.raw.slice(0, at) + rawValue(p);
            })
            .join("")}\n\t}`
        );
    if (kind === "independent") {
      for (const role of ["ordinary", "eminent"] as const)
        if (sites[role].length)
          extra.push(
            `\n\t${role === "ordinary" ? "holy_sites" : "eminent_holy_sites"} = { ${sites[role].map((p) => commentText(p.raw, w) + rawValue(p)).join("\n")} }`
          );
      if (sites.ordinary.length || sites.eminent.length) {
        const rel = convertedRel.get(def.religion!.id) ?? [];
        const defaults = context
          .list("target", "common/defines")
          .map((p) => context.readText("target", p) ?? "")
          .join("\n");
        const limit = (key: string, define: string) => {
          const override = rel.find((p) => p.key === key);
          const value = override
            ? Number(scalar(override.node))
            : Number(defaults.match(new RegExp(`\\b${define}\\s*=\\s*(\\d+)`))?.[1]);
          return Number.isFinite(value) ? value : undefined;
        };
        for (const [count, key, define, minimum] of [
          [sites.eminent.length, "eminent_holy_sites_max", "FAITH_EMINENT_HOLY_SITES_MAX_DEFAULT", false],
          [
            sites.ordinary.length + sites.eminent.length,
            "holy_sites_max",
            "FAITH_HOLY_SITES_MAX_DEFAULT",
            false,
          ],
          [sites.eminent.length, "eminent_holy_sites_min", "FAITH_EMINENT_HOLY_SITES_MIN_DEFAULT", true],
          [
            sites.ordinary.length + sites.eminent.length,
            "holy_sites_min",
            "FAITH_HOLY_SITES_MIN_DEFAULT",
            true,
          ],
        ] as const) {
          const n = limit(key, define);
          if (n === undefined)
            w.fail(
              `site-limit:${id}:${key}`,
              `Capture target ${define} or set ${key} on the religion before assigning holy sites.`,
              def
            );
          else if (minimum ? count < n : count > n)
            w.fail(
              `site-limit:${id}:${key}`,
              `${id} has ${count} sites for ${key}; target religion requires ${minimum ? "at least" : "at most"} ${n}. Change the selected site roles or resolve the religion limit.`,
              def
            );
        }
      }
    }
    output.set(id, { def, fields: kept, extra, tail: original.tail, kind });
  }
  // Faith-only behavior cannot silently vanish when a community becomes a rite.
  for (const [id, item] of output)
    if (item.kind === "rite") {
      const parent = parents.get(id);
      const target = parent ? output.get(parent) : undefined;
      item.fields = item.fields.filter((p) => {
        if (riteKeys.has(p.key)) return true;
        const key = `faith:${id}:field:${p.key}`;
        const choice = w.ask(
          key,
          `Faith-wide ${id}.${p.key}`,
          [
            { value: "parent", label: "Use the selected parent's behavior" },
            ...(target?.kind === "independent" && p.key !== "holy_site"
              ? [{ value: "transfer", label: "Transfer this value to the converted parent faith" }]
              : []),
          ],
          `A rite cannot own this field. Keeping parent behavior deliberately discards this community's override. Transfer changes every rite under ${parent ?? "the selected parent"}. Holy sites require an independent faith.`
        );
        if (choice === "transfer" && target) {
          const existing = target.fields.filter((f) => f.key === p.key);
          if (existing.length && !equivalent(existing, [p]))
            w.fail(
              `transfer-conflict:${id}:${p.key}`,
              `Parent ${parent} has a different ${p.key}. Resolve the values manually or choose parent behavior.`,
              item.def,
              p.node.range.start
            );
          else if (!existing.length) target.fields.push(p);
        }
        // Retain source comments even when the author deliberately selects parent behavior.
        item.extra.push("\n" + commentText(p.raw, w));
        return false;
      });
      if (parent) {
        const parentDef = target?.def ?? modFaiths.get(parent) ?? targetFaiths.get(parent);
        const parentReligion =
          target?.def.religion?.id ??
          scalar(parentDef ? field(field(parentDef.node, "faith_details")!, "religion") : undefined);
        if (parentReligion && parentReligion !== item.def.religion!.id)
          w.ask(
            `faith:${id}:inheritance`,
            `Religion inheritance for ${id}`,
            [
              {
                value: "parent",
                label: "Adopt the parent religion's traits, names, localization and defaults",
              },
            ],
            `The new parent belongs to ${parentReligion}; ${item.def.religion!.id}'s inherited behavior cannot remain on a rite. Choose an independent faith to preserve it.`
          );
      }
    }
  for (const [id, item] of output) {
    const parent = parents.get(id);
    const allowed = item.kind === "independent" ? new Set([...faithKeys, ...details]) : riteKeys;
    for (const p of item.fields)
      if (!allowed.has(p.key) && !sourceRel.has(item.def.religion!.id))
        w.fail(
          `unsupported-field:${id}:${p.key}`,
          `Target documentation does not support ${id}.${p.key}. Resolve this field before conversion.`,
          item.def,
          p.node.range.start
        );
    const body =
      item.kind === "independent"
        ? `\n\tfaith_details = {\n\t\treligion = ${item.def.religion!.id}${item.fields
            .filter((p) => details.has(p.key))
            .map((p) => p.raw)
            .join("")}\n\t}${item.fields
            .filter((p) => !details.has(p.key))
            .map((p) => p.raw)
            .join("")}`
        : `\n\tfaith = ${parent ?? ""}${item.fields.map((p) => p.raw).join("")}`;
    if (item.kind === "rite" && !parent) continue;
    let converted = rebaseFaith(
      w,
      item.def,
      sourceRel.get(item.def.religion!.id),
      (item.kind === "independent" ? targetFaiths : targetRites).get(id),
      `${id} = {${body}${item.extra.join("")}${item.tail}\n}\n`,
      details,
      tenets,
      item.kind
    );
    if (item.kind === "independent") converted = supplyFemaleHeadTitle(w, item.def, converted, targetRel);
    const parsedDefinition = assignments(parse(converted).root.statements)[0];
    for (const property of children(parsedDefinition)) {
      const fieldsToCheck = property.key.text === "faith_details" ? children(property) : [property];
      for (const propertyToCheck of fieldsToCheck)
        if (!allowed.has(propertyToCheck.key.text))
          w.fail(
            `unsupported-field:${id}:${propertyToCheck.key.text}`,
            `Target documentation does not support ${id}.${propertyToCheck.key.text}. Resolve this field before conversion.`,
            item.def
          );
    }
    w.creates.set(`${item.kind === "independent" ? FAITHS : RITES}/px_migrated_${id}.txt`, converted);
  }
  for (const religion of religions.filter((r) => field(r.node, "faiths"))) {
    const fields = convertedRel.get(religion.id)!;
    const valid = new Set([...children(religionSchema).map((n) => n.key.text), ...religionDetails]);
    for (const p of fields)
      if (!valid.has(p.key))
        w.fail(
          `religion-field:${religion.id}:${p.key}`,
          `Target religion documentation does not support ${p.key}; resolve this inherited field manually.`,
          religion,
          p.node.range.start
        );
    const tail = pieces(religion.node, religion.text).tail;
    const comments = commentText(religion.text.slice(religion.node.range.start, religion.node.range.end), w);
    const rendered = supplyFemaleHeadTitle(
      w,
      religion,
      renderReligion(religion.id, fields, religionDetails, tail),
      targetRel
    );
    const constants = unresolvedFileConstants(rendered);
    if (constants.length)
      w.fail(
        `unresolved-constants:religion:${religion.id}`,
        `Cannot preserve inherited file-local bindings ${constants.join(", ")}. Resolve unsupported, ambiguous or unavailable constants before conversion.`,
        religion
      );
    const remaining = new Set(parse(rendered).comments.map((c) => c.text));
    const preserved = comments
      .split("\n")
      .filter((c) => c && !remaining.has(c))
      .join("\n");
    w.addEdit(religion.path, {
      ...religion.node.range,
      text: rendered + (preserved ? "\n" + preserved + "\n" : ""),
    });
  }
  convertFaithConsumers(w, old, parents, tenets);
  return finish("applicable");
}
