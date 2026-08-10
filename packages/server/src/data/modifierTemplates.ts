/**
 * Templated modifier tags from modifiers.log (`$CULTURE$_opinion`,
 * `stationed_$MEN_AT_ARMS_TYPE$_damage_add`, …): the engine generates one
 * concrete modifier per definition (e.g. `french_opinion` for the culture
 * `french`). Like the generated `has_relation_X` cards in hover.ts, expansion
 * is LAZY — matched against the definition index on hover / expanded once per
 * completion cache build — never materialized into tokenMap (huge mods define
 * thousands of cultures).
 *
 * The placeholder table itself is game knowledge and lives in the game
 * profile (games/<id>/modifierPlaceholders.ts).
 *
 * No `vscode` imports here: this module is unit-tested in plain Node.
 */
import * as path from "path";
import type { Definition, TokenData } from "@px-lsp/protocol/types";
import { activeProfile } from "../games/active";

export interface PlaceholderSpec {
  /** Definition-index kind the placeholder expands over. */
  kind?: string;
  /** Fixed engine value set, for placeholders not backed by the index. */
  values?: readonly string[];
  /** Human label for hover/completion docs ("culture", "men-at-arms base type"). */
  label: string;
  /** Values that do NOT exist for templates with the given prefix
   * (verified per-game exceptions to `values`). */
  excludeValues?: Record<string, readonly string[]>;
}

export interface ModifierTemplate {
  /** The raw templated tag, e.g. `stationed_$MEN_AT_ARMS_TYPE$_damage_add`. */
  name: string;
  prefix: string;
  suffix: string;
  placeholder: string;
  spec: PlaceholderSpec;
  /** Metadata lines from the log ("Use areas: character"). */
  traits?: string;
}

const TEMPLATE_NAME = /^([a-z0-9_]*)\$([A-Z_]+)\$([a-z0-9_]*)$/;

/** Compile raw templated tokens into matchable templates; unknown placeholders are dropped. */
export function compileModifierTemplates(raw: TokenData[]): ModifierTemplate[] {
  const placeholders = activeProfile().modifierPlaceholders;
  const templates: ModifierTemplate[] = [];
  for (const t of raw) {
    const m = TEMPLATE_NAME.exec(t.name);
    if (!m) continue;
    let spec = placeholders[m[2]];
    if (!spec) continue;
    const excluded = spec.values && spec.excludeValues?.[m[1]];
    if (excluded) {
      spec = { ...spec, values: spec.values!.filter((v) => !excluded.includes(v)) };
    }
    templates.push({ name: t.name, prefix: m[1], suffix: m[3], placeholder: m[2], spec, traits: t.traits });
  }
  return templates;
}

export interface TemplateMatch {
  template: ModifierTemplate;
  /** The definition/base-type name the placeholder matched ("french"). */
  base: string;
  /** The matched definition; undefined for fixed-value placeholders. */
  def?: Definition;
}

/**
 * Match a concrete name (`french_opinion`) against the templates: the first
 * template whose placeholder slice resolves — to a fixed engine value or to an
 * indexed definition of the mapped kind — wins. Shared-suffix ambiguity
 * (`_opinion` appears in six templates) is resolved by that lookup.
 */
export function matchTemplatedModifier(
  word: string,
  templates: ModifierTemplate[],
  lookup: (name: string) => Definition[]
): TemplateMatch | null {
  for (const template of templates) {
    const minLen = template.prefix.length + template.suffix.length + 1;
    if (word.length < minLen) continue;
    if (!word.startsWith(template.prefix) || !word.endsWith(template.suffix)) continue;
    const base = word.slice(template.prefix.length, word.length - template.suffix.length);
    if (template.spec.values) {
      if (template.spec.values.includes(base)) return { template, base };
      continue;
    }
    const def = lookup(base).find((d) => d.kind === template.spec.kind);
    if (def) return { template, base, def };
  }
  return null;
}

/** One-line doc for a matched expansion, shared by hover and completion resolve. */
export function templatedModifierDoc(m: TemplateMatch): string {
  if (m.def) {
    return `Modifier the engine generates for the ${m.template.spec.label} \`${m.base}\` (${path.basename(m.def.file)}:${m.def.line + 1}).`;
  }
  return `Modifier the engine generates for the built-in ${m.template.spec.label} \`${m.base}\`.`;
}

export interface TemplateExpansion {
  name: string;
  template: ModifierTemplate;
  /** The definition the expansion came from; undefined for fixed value sets. */
  def?: Definition;
}

/**
 * Expand every template against the definition index (one pass) plus the fixed
 * value sets. Used to build the completion list for modifier contexts; hover
 * uses matchTemplatedModifier instead and never needs the full expansion.
 */
export function expandModifierTemplates(
  templates: ModifierTemplate[],
  index: { entries(filter?: (def: Definition) => boolean): IterableIterator<Definition> },
  completableKinds: ReadonlySet<string>
): TemplateExpansion[] {
  const byKind = new Map<string, ModifierTemplate[]>();
  const out: TemplateExpansion[] = [];
  for (const template of templates) {
    if (template.spec.values) {
      for (const v of template.spec.values)
        out.push({ name: template.prefix + v + template.suffix, template });
      continue;
    }
    const kind = template.spec.kind!;
    if (completableKinds.size > 0 && !completableKinds.has(kind)) continue;
    const list = byKind.get(kind);
    if (list) list.push(template);
    else byKind.set(kind, [template]);
  }
  if (byKind.size > 0) {
    for (const def of index.entries((d) => byKind.has(d.kind))) {
      for (const template of byKind.get(def.kind) ?? []) {
        out.push({ name: template.prefix + def.name + template.suffix, template, def });
      }
    }
  }
  return out;
}
