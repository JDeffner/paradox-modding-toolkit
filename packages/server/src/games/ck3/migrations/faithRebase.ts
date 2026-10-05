import type { FaithWork, Definition } from "./faithConversion";
import { assignments, children, field, scalar, pieces, equivalent, type Piece } from "./faithSyntax";

/** Both shipped grouped history and the filename grammar described by _faith_history.info. */
function datedMainRites(w: FaithWork, id: string): string[] {
  const paths = new Set([
    ...w.context.list("target", "history/faiths"),
    ...w.context.list("mod", "history/faiths"),
  ]);
  return [...paths].filter((path) => {
    if (!path.endsWith(".txt")) return false;
    const text = w.context.readText("mod", path) ?? w.context.readText("target", path);
    if (text === undefined) return false;
    const roots = assignments(w.parse(text).root.statements);
    const grouped = roots.filter((node) => node.key.text === id);
    const dated = grouped.length
      ? grouped.flatMap(children)
      : path.slice(path.lastIndexOf("/") + 1, -4) === id
        ? roots
        : [];
    return dated.some((node) => /^\d+\.\d+\.\d+$/.test(node.key.text) && field(node, "main_rite"));
  });
}

/** Rebase a converted vanilla faith without losing target additions or deliberate mod edits. */
export function rebaseFaith(
  w: FaithWork,
  mod: Definition,
  sourceReligion: Definition | undefined,
  target: Definition | undefined,
  converted: string,
  details: Set<string>,
  tenets: Set<string>,
  kind: string
): string {
  if (!sourceReligion || !target) return converted;
  const sourceNode = children(field(sourceReligion.node, "faiths")!).find((n) => n.key.text === mod.id);
  if (!sourceNode) {
    w.fail(
      `faith-baseline:${mod.id}`,
      `Target ${mod.id} has no matching old faith in the source religion. Resolve this ID collision manually.`,
      mod
    );
    return converted;
  }
  const flatten = (text: string, node = assignments(w.parse(text).root.statements)[0]): Piece[] => {
    return pieces(node, text).fields.flatMap((p) =>
      p.key === "faith_details" ? pieces(p.node, text).fields : [p]
    );
  };
  const baseFields = pieces(sourceNode, sourceReligion.text).fields;
  const selected = { tenets: [] as string[], doctrines: [] as string[] };
  const sites = { holy_sites: [] as string[], eminent_holy_sites: [] as string[] };
  const targetSite = (id: string): string => {
    const eminent = field(target.node, "eminent_holy_sites")?.value;
    return eminent?.kind === "block" &&
      eminent.statements.some((n) => n.kind === "value" && n.value.kind === "scalar" && n.value.text === id)
      ? "eminent"
      : "ordinary";
  };
  const plain: string[] = [];
  for (const p of baseFields) {
    const value = scalar(p.node);
    if (p.key === "doctrine" && value) selected[tenets.has(value) ? "tenets" : "doctrines"].push(value);
    else if (p.key === "holy_site" && value && kind === "independent") {
      const role = w.answers[`faith:${mod.id}:holy-site:${value}`] ?? targetSite(value);
      sites[role === "eminent" ? "eminent_holy_sites" : "holy_sites"].push(value);
    } else if (p.key === "doctrine_selection_pair") {
      plain.push(
        p.raw
          .replace(/\bdoctrine_selection_pair\b/, "tenet_selection_pair")
          .replace(/\bfallback_doctrine\s*=/g, "fallback_tenet =")
          .replace(/\bdoctrine\s*=/g, "tenet =")
      );
    } else plain.push(p.raw);
  }
  for (const [key, ids] of Object.entries({ ...selected, ...sites }))
    if (ids.length) plain.push(`\n${key} = { ${ids.join(" ")} }`);
  if (kind === "independent") plain.push(`\nreligion = ${sourceReligion.id}`);
  const base = flatten(`${mod.id} = { ${plain.join("\n")} }`),
    mine = flatten(converted),
    next = flatten(target.text, target.node);
  const merged: Piece[] = [];
  for (const key of new Set([...next, ...mine, ...base].map((p) => p.key))) {
    // Author choices establish these new relationships and holy-site roles.
    if (["faith", "religion", "holy_sites", "eminent_holy_sites"].includes(key)) {
      merged.push(...mine.filter((p) => p.key === key));
      continue;
    }
    const b = base.filter((p) => p.key === key),
      m = mine.filter((p) => p.key === key),
      t = next.filter((p) => p.key === key);
    if (equivalent(m, b)) merged.push(...t);
    else if (equivalent(t, b) || equivalent(m, t)) merged.push(...m);
    else {
      const answer = w.ask(
        `faith:${mod.id}:conflict:${key}`,
        `Resolve ${mod.id}.${key}`,
        [
          { value: "mod", label: "Keep the mod value (including removal)" },
          { value: "target", label: "Use the target game value" },
        ],
        "This converted field changed in both the mod and target. Unchanged fields retain target updates."
      );
      merged.push(...(answer === "target" ? t : m));
    }
  }
  const history = kind === "independent" ? datedMainRites(w, mod.id) : [];
  if (kind === "independent" && (merged.some((p) => p.key === "main_rite") || history.length)) {
    const choice = w.ask(
      `faith:${mod.id}:main-rite`,
      `Main rite for ${mod.id}`,
      [
        { value: "dynamic", label: "Create a dynamic main rite using the converted mod's core tenets" },
        { value: "target", label: "Keep the target's scripted main rite and its core tenets" },
      ],
      "A scripted main rite overrides faith-level core tenets. Choose which behavior this independent faith needs."
    );
    if (choice === "dynamic") {
      // Target core tenets may have moved off the faith and onto its scripted rite.
      // Their absence on the target faith is not permission to drop the chosen mod tenets.
      for (let i = merged.length - 1; i >= 0; i--)
        if (["main_rite", "tenets", "tenet_selection_pair"].includes(merged[i].key)) merged.splice(i, 1);
      merged.push(...mine.filter((piece) => ["tenets", "tenet_selection_pair"].includes(piece.key)));
      for (const path of history)
        w.fail(
          `dated-main-rite:${mod.id}:${path}`,
          `Dated history in ${path} selects a scripted main rite for ${mod.id}, overriding the dynamic choice. Resolve those dated assignments in the mod before conversion, or keep the target scripted main rite.`,
          { path }
        );
    }
  }
  const body =
    kind === "independent"
      ? `\nfaith_details = {${merged
          .filter((p) => details.has(p.key))
          .map((p) => p.raw)
          .join("\n")}\n}\n${merged
          .filter((p) => !details.has(p.key))
          .map((p) => p.raw)
          .join("\n")}`
      : merged.map((p) => p.raw).join("\n");
  const comments = w
    .parse(converted)
    .comments.map((c) => c.text)
    .filter((c) => !body.includes(c));
  return `${mod.id} = {${body}\n}\n${comments.join("\n")}\n`;
}
