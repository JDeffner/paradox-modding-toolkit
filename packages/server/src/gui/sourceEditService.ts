// Implements the source-writer design of Sage's Clausewitz Studio; behavior contract in docs/gui-designer/parity-checklist.md. GPL-3.0-or-later.
/**
 * paradox/guiSourceEdit backend: one request that turns a designer gesture into
 * text edits over a `.gui` document, or into an honest REFUSAL.
 *
 * The edits themselves are `sourceEdit.ts`'s, over the spans `sourceModel.ts`
 * recorded, so untouched bytes stay byte-identical. What this layer adds is the
 * part a preview cannot see: whether the gesture would do what it looks like it
 * does. A property the engine ignores looks applied in the preview and does
 * nothing in game, which is the worst outcome a visual editor can produce, so
 * the guards below turn those gestures down with a reason instead of writing
 * them (W10, W18, S09).
 *
 * Every layout fact a guard reads comes from the engine itself
 * (`widgetClassOf`) or from the type chain (`typeBaseChain`), never re-derived
 * here: a guard that disagreed with the engine would refuse writes the preview
 * had just shown working.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type {
  GuiSourceEditResult,
  GuiSourceOp,
  GuiSourceOpResult,
  GuiTextEdit,
  GuiNewWidget,
} from "@px-lsp/protocol/protocol";
import {
  findEntry,
  findWidgetAtLine,
  parseGuiSource,
  type GuiEntry,
  type GuiSourceFile,
} from "./sourceModel";
import {
  blockText,
  deleteWidget,
  duplicateWidget,
  insertChild,
  insertProperties,
  insertRawChild,
  removeProperty,
  reorderChild,
  setValue,
  wrapInContainer,
  type GuiEdit,
} from "./sourceEdit";
import { typeBaseChain, type GuiDefs } from "./guiDefs";
import { widgetClassOf, type WidgetClass } from "./layoutEngine";
import type { BlockNode, Statement } from "../parser";

// ── Refusal guards ──────────────────────────────────────────────────────────

/** hbox / vbox / flowcontainer: the container places its children itself. */
function isLayoutContainer(cls: WidgetClass): boolean {
  return cls === "box" || cls === "flow";
}

/** The engine's class for an instance key, resolved through the TYPE CHAIN. */
function classOf(key: string, defs: GuiDefs): WidgetClass {
  const chain = typeBaseChain(key, [defs]);
  return widgetClassOf(chain.length > 0 ? chain[chain.length - 1] : key);
}

/**
 * Why a `position` write on this widget would be ignored, or null when it
 * lands: a layout container owns its children's slots, so a drag inside one
 * changes the file without changing the screen (W10).
 *
 * The engine here still ADDS a box child's position as an offset, and the two
 * engines disagree about that (parity-checklist L23, disputed, one in-game
 * probe outstanding). The writer takes the measured side: the Studio's engine
 * drops it, spec.md is silent, and this engine's own note calls its choice
 * unmeasured. Refusing to write a property the game most likely ignores is the
 * safe half of the disagreement; settling L23 the other way removes this guard.
 */
export function positionIgnoredReason(entry: GuiEntry, defs: GuiDefs): string | null {
  const parent = entry.parent;
  if (!parent) return null;
  const cls = classOf(parent.keyLower, defs);
  if (!isLayoutContainer(cls)) return null;
  return `${parent.key} places its children itself, so a position on this child is dropped: the move would change the file without changing anything on screen.`;
}

/** A size write that is refused outright, or written with one axis warned about. */
export interface SizeGuard {
  refused?: string;
  warning?: string;
}

/**
 * Whether a `size` write lands (W10, S09). An hbox/vbox sizes to its children
 * whatever the file says; a flowcontainer KEEPS an authored size (in-game
 * probe 2026-08-02, L13e), so it is NOT refused here; a child expanding on
 * BOTH axes inside a layout container has both taken from it; one expanding
 * axis writes and says which axis the container owns. Outside a layout
 * container the policy means nothing and the guard must NOT fire, or it
 * starts refusing resizes the engine would have honoured.
 */
export function sizeIgnoredReason(entry: GuiEntry, defs: GuiDefs): SizeGuard {
  const cls = classOf(entry.keyLower, defs);
  if (cls === "box") {
    return {
      refused: `${entry.key} is content-sized: it takes its size from its children and ignores an explicit size.`,
    };
  }
  const parent = entry.parent;
  if (!parent || !isLayoutContainer(classOf(parent.keyLower, defs))) return {};

  const horizontal = policyThroughChain(entry, "layoutpolicy_horizontal", defs) === "expanding";
  const vertical = policyThroughChain(entry, "layoutpolicy_vertical", defs) === "expanding";
  if (horizontal && vertical) {
    return {
      refused: `this widget is expanding on both axes inside ${parent.key}, which takes its size from the container: neither axis would change.`,
    };
  }
  if (horizontal || vertical) {
    const axis = horizontal ? "width" : "height";
    return {
      warning: `${parent.key} owns the ${axis} of an expanding child, so only the other axis will change.`,
    };
  }
  return {};
}

/**
 * A scalar property as the engine resolves it: the instance's own entry first,
 * then the type chain, derived-most first. A `layoutpolicy_*` usually lives in
 * the type definition rather than at the use site, and a guard that only read
 * the instance would miss it.
 */
function policyThroughChain(entry: GuiEntry, key: string, defs: GuiDefs): string | null {
  const local = entry.body ? findEntry(entry.body, key) : null;
  if (local?.value != null && local.valueKind === "scalar") return local.value.toLowerCase();
  for (const name of [entry.keyLower, ...typeBaseChain(entry.keyLower, [defs])]) {
    const def = defs.types.get(name.toLowerCase());
    if (!def) continue;
    const found = lastScalar(def.block, key);
    if (found !== null) return found.toLowerCase();
  }
  return null;
}

/** The last `key = <scalar>` directly in a definition body (last-in-wins). */
function lastScalar(block: BlockNode, key: string): string | null {
  let found: string | null = null;
  for (const stmt of block.statements as Statement[]) {
    if (stmt.kind !== "assignment" || stmt.value?.kind !== "scalar") continue;
    if (stmt.key.text.toLowerCase() === key) found = stmt.value.text;
  }
  return found;
}

/**
 * A `type` definition's body. Other files instantiate it, so a structural edit
 * there reaches further than the preview it was made in shows (W18).
 */
function insideTypeDefinition(entry: GuiEntry): boolean {
  for (let e: GuiEntry | null = entry; e; e = e.parent) {
    if (e.marker === "type" || e.marker === "types") return true;
  }
  return false;
}

// ── The op API ──────────────────────────────────────────────────────────────

const NO_WIDGET =
  "no editable widget on that line: a node spliced in from a template or a type has no source of its own here.";
const IN_TYPE =
  "this is inside a type definition, and other files instantiate it: edit the type's own file deliberately rather than through one instance's preview.";

/**
 * Answers one {@link GuiSourceOp} against `text`. Null means the request itself
 * makes no sense (an unknown op kind); everything a user can legitimately ask
 * for comes back as edits or as a refusal with a reason.
 */
export function computeGuiSourceEdit(
  text: string,
  op: GuiSourceOp | null | undefined,
  defs: GuiDefs
): GuiSourceEditResult | null {
  if (!op || typeof op.kind !== "string") return null;
  const file = parseGuiSource(text);
  const unparseable = parseRefusal(file);
  if (unparseable) return unparseable;
  return runOp(file, op, defs);
}

/**
 * Answers a BATCH against the one authoritative `text`: every op is computed
 * against the SAME source model, so one gesture over several widgets is one
 * edit set, one document change and one undo step.
 *
 * The honesty rules the single-op path has, kept per op: a refusal is that op's
 * own answer and skips only it, and an op whose bytes an EARLIER one already
 * changes is refused rather than dropped, because `applyAll` drops an
 * overlapping edit silently and an op reported as applied must have been.
 */
export function computeGuiSourceEdits(
  text: string,
  ops: readonly GuiSourceOp[] | null | undefined,
  defs: GuiDefs
): GuiSourceEditResult | null {
  if (!Array.isArray(ops)) return null;
  if (ops.length === 0) return { refused: "that gesture named no widgets to change." };
  const file = parseGuiSource(text);
  const unparseable = parseRefusal(file);
  if (unparseable) return unparseable;

  const results: GuiSourceOpResult[] = [];
  const edits: GuiTextEdit[] = [];
  const warnings: string[] = [];
  for (const op of ops) {
    const answer = !op || typeof op.kind !== "string" ? null : runOp(file, op, defs);
    if (!answer) {
      results.push({ refused: "the server has no such edit.", edits: [] });
      continue;
    }
    const own = answer.edits ?? [];
    if (answer.refused || own.length === 0) {
      results.push({ refused: answer.refused, warning: answer.warning, edits: [], blockText: answer.blockText });
      if (answer.warning) warnings.push(answer.warning);
      continue;
    }
    if (overlapping([...edits, ...own])) {
      results.push({
        refused:
          "another change in the same gesture already rewrites those bytes, so this one was left out: make it on its own.",
        edits: [],
      });
      continue;
    }
    edits.push(...own);
    results.push({ warning: answer.warning, edits: own, blockText: answer.blockText });
    if (answer.warning) warnings.push(answer.warning);
  }
  return { edits, results, warning: warnings.length > 0 ? [...new Set(warnings)].join(" ") : undefined };
}

/** A document with parse errors has no trustworthy offset, single op or batch. */
function parseRefusal(file: GuiSourceFile): GuiSourceEditResult | null {
  if (file.errors.length === 0) return null;
  return {
    refused: `this document has ${file.errors.length} parse error(s), so no offset in it can be trusted: fix the syntax first.`,
  };
}

function runOp(file: GuiSourceFile, op: GuiSourceOp, defs: GuiDefs): GuiSourceEditResult | null {
  switch (op.kind) {
    case "setProperties":
      return withTarget(file, op.line, (target) => setProperties(file, target, op.properties ?? [], defs));

    case "reorder":
      return withTarget(file, op.line, (target) =>
        structural(target, () => {
          const edit = reorderChild(file, target, op.from, op.to);
          return edit
            ? { edits: [edit] }
            : {
                refused:
                  "these children cannot be reordered: the body has fewer than two source children, a declaration shares a line with another, or the move is a no-op.",
              };
        })
      );

    case "insert":
      return withTarget(file, op.line, (target) =>
        structural(target, () =>
          single(insertChild(file, target, widgetOf(op.widget), indexOf(op.index)), INSERT_REFUSED)
        )
      );

    case "insertRaw":
      return withTarget(file, op.line, (target) =>
        structural(target, () =>
          single(
            insertRawChild(file, target, op.fragment ?? "", indexOf(op.index)),
            "that text cannot be pasted here: it is blank, it does not parse as widget declarations, or the destination body is a single line a paste would explode."
          )
        )
      );

    case "delete":
      return withTarget(file, op.line, (target) =>
        structural(target, () => {
          if (!target.parent && file.root.children.length <= 1) {
            return {
              refused: "this is the document's only root widget: deleting it would leave an empty file.",
            };
          }
          return { edits: [deleteWidget(file, target)] };
        })
      );

    case "duplicate":
      return withTarget(file, op.line, (target) =>
        structural(target, () =>
          single(
            duplicateWidget(file, target, op.name),
            "this widget cannot be duplicated: it shares its line with another declaration, or the rename has no name entry to rewrite."
          )
        )
      );

    case "wrap":
      return wrap(file, op.lines ?? [], widgetOf(op.container));

    case "blockText": {
      return withTarget(file, op.line, (target) => {
        const copied = blockText(file, target);
        return copied === null
          ? { refused: "this declaration shares its line with another one, so it has no block to copy." }
          : { edits: [], blockText: copied };
      });
    }

    default:
      return null;
  }
}

const INSERT_REFUSED =
  "a child cannot be inserted here: the widget has no body, or its closing brace shares a line with its last content and there is no line to write on.";

function withTarget(
  file: GuiSourceFile,
  line: number,
  run: (target: GuiEntry) => GuiSourceEditResult
): GuiSourceEditResult {
  const target = findWidgetAtLine(file, line);
  return target ? run(target) : { refused: NO_WIDGET };
}

/** Every structural op refuses inside a type definition (W18). */
function structural(target: GuiEntry, run: () => GuiSourceEditResult): GuiSourceEditResult {
  return insideTypeDefinition(target) ? { refused: IN_TYPE } : run();
}

function single(edit: GuiEdit | null, refused: string): GuiSourceEditResult {
  return edit ? { edits: [edit] } : { refused };
}

function widgetOf(widget: GuiNewWidget | undefined): GuiNewWidget {
  return { type: widget?.type ?? "", properties: widget?.properties ?? [] };
}

function indexOf(index: number | undefined): number {
  return typeof index === "number" ? index : Infinity;
}

/**
 * A property batch: rewrites in place where the key already exists, one shared
 * insert for the keys that do not, and the guards run per property so a single
 * ignored write refuses the whole gesture rather than half-applying it.
 */
function setProperties(
  file: GuiSourceFile,
  target: GuiEntry,
  properties: readonly { key: string; value: string | null }[],
  defs: GuiDefs
): GuiSourceEditResult {
  const edits: GuiEdit[] = [];
  const warnings: string[] = [];
  const missing: [string, string][] = [];

  for (const { key, value } of properties) {
    const lower = key.trim().toLowerCase();
    if (lower.length === 0) continue;
    if (lower === "position") {
      const reason = positionIgnoredReason(target, defs);
      if (reason) return { refused: reason };
    }
    if (lower === "size") {
      const guard = sizeIgnoredReason(target, defs);
      if (guard.refused) return { refused: guard.refused };
      if (guard.warning) warnings.push(guard.warning);
    }

    const existing = target.body ? findEntry(target.body, key) : null;
    const local = existing?.kind === "property" ? existing : null;
    if (value === null) {
      const edit = local ? removeProperty(file, local) : null;
      if (edit) edits.push(edit);
      continue;
    }
    if (local) {
      const edit = setValue(file, local, value);
      if (edit) edits.push(edit);
    } else if (target.body && target.body.close !== null) {
      // No local entry: a template- or type-supplied value is overridden HERE,
      // and the definition's own bytes are untouched (W09).
      missing.push([key, value]);
    } else {
      return { refused: "this widget has no body to write a property into." };
    }
  }

  const insert = missing.length > 0 ? insertProperties(file, target, missing) : null;
  if (insert) edits.push(insert);
  if (overlapping(edits)) {
    return {
      refused:
        "these changes cannot be expressed as one batch of independent edits: apply them one at a time.",
    };
  }
  return { edits, warning: warnings.length > 0 ? warnings.join(" ") : undefined };
}

/** Wrap: every line must resolve to a widget, and they must be siblings (W22). */
function wrap(file: GuiSourceFile, lines: readonly number[], container: GuiNewWidget): GuiSourceEditResult {
  const members: GuiEntry[] = [];
  for (const line of lines) {
    const entry = findWidgetAtLine(file, line);
    if (!entry) return { refused: NO_WIDGET };
    if (insideTypeDefinition(entry)) return { refused: IN_TYPE };
    members.push(entry);
  }
  const edits = wrapInContainer(file, members, container);
  return edits
    ? { edits }
    : {
        refused:
          "these widgets cannot be wrapped: the selection is empty, they are not children of the same body, or one shares its line with another declaration.",
      };
}

/** Two edits that touch the same bytes cannot both be applied (W05, W23). */
function overlapping(edits: readonly GuiTextEdit[]): boolean {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (sorted[i].end > sorted[i + 1].start) return true;
  }
  return false;
}
