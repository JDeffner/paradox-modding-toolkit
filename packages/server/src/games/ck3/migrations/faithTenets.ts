import { walkStatements } from "../../../parser/cst";
import type { MigrationTextEdit, MigrationContext } from "../../../migrations/sdk";
import type { FaithWork, Definition } from "./faithConversion";
import { assignments, children, field, scalar, editText, resolveFileConstants } from "./faithSyntax";

/** Read only the custom doctrine icons named by captured definitions. */
export async function discoverFaithIcons(context: MigrationContext) {
  const { parseScript } = await import("../../../parser/parser");
  const paths = new Set<string>();
  for (const path of context
    .list("mod", "common/religion/doctrine_types")
    .filter((p) => p.endsWith(".txt"))) {
    const text = context.readText("mod", path);
    if (text === undefined) continue;
    for (const definition of assignments(parseScript(text).root.statements)) {
      const icon = field(definition, "icon") ? scalar(field(definition, "icon")) : definition.key.text;
      if (!icon || !/^[A-Za-z0-9_.-]+$/.test(icon)) continue;
      const source = `gfx/interface/icons/faith_doctrines/${icon}.dds`;
      if (
        context.fileInfo("mod", source) &&
        !context.fileInfo("mod", `gfx/interface/icons/faith_tenets/${icon}.dds`)
      )
        paths.add(source);
    }
  }
  return [...paths].sort().map((path) => ({ root: "mod" as const, path }));
}

/** Target tenet schema changes are applied only where their scope is established. */
export function convertCustomTenets(w: FaithWork, definitions: Definition[], tenets: Set<string>): void {
  if (!definitions.length) return;
  const doc = w.context.readText("target", "common/religion/tenet_types/_tenet_types.info");
  if (!doc) {
    w.fail("tenet-schema-missing", "Capture target tenet documentation before converting custom tenets.");
    return;
  }
  const schema = w
    .parse(doc)
    .root.statements.find((n) => n.kind === "assignment" && n.value?.kind === "block");
  const allowed = new Set(schema?.kind === "assignment" ? children(schema).map((n) => n.key.text) : []);
  for (const def of definitions) {
    const iconNode = field(def.node, "icon");
    const icon = iconNode ? scalar(iconNode) : def.id;
    if (icon && /^[A-Za-z0-9_.-]+$/.test(icon)) {
      const oldPath = `gfx/interface/icons/faith_doctrines/${icon}.dds`;
      const newPath = `gfx/interface/icons/faith_tenets/${icon}.dds`;
      const previous = w.context.readBytes("mod", oldPath);
      if (!w.context.fileInfo("mod", newPath)) {
        if (previous) w.binaryCreates.set(newPath, previous);
        else if (!w.context.fileInfo("target", newPath))
          w.fail(
            `tenet-icon:${def.id}`,
            `Tenet ${def.id} needs ${newPath}. Supply it or capture the old mod icon ${oldPath} so it can be copied.`,
            def
          );
      }
    } else
      w.fail(
        `tenet-icon:${def.id}`,
        "Dynamic tenet icons need a manual path review against the new faith_tenets icon directory.",
        def
      );
    const edits: MigrationTextEdit[] = [];
    const local = (start: number, end: number, text: string) =>
      edits.push({ start: start - def.node.range.start, end: end - def.node.range.start, text });
    for (const property of children(def.node)) {
      if (!allowed.has(property.key.text)) {
        w.fail(
          `tenet-field:${def.id}:${property.key.text}`,
          `Custom tenet ${def.id} uses unsupported field ${property.key.text}. Convert it against target documentation.`,
          def,
          property.range.start
        );
        continue;
      }
      if (property.key.text === "parameters")
        for (const parameter of children(property)) {
          if (scalar(parameter) !== "yes")
            w.fail(
              `tenet-parameter:${def.id}:${parameter.key.text}`,
              `Tenet parameter ${parameter.key.text} is not a true flag. Resolve its target behavior manually.`,
              def,
              parameter.range.start
            );
          else local(parameter.key.range.end, parameter.range.end, "");
        }
      if (property.value?.kind !== "block") continue;
      walkStatements(property.value, (statement, ancestors) => {
        if (statement.kind !== "assignment") return;
        const value = scalar(statement),
          key = statement.key.text;
        if (key === "has_doctrine" && value && (tenets.has(value) || property.key.text === "piety_cost"))
          local(
            statement.key.range.start,
            statement.key.range.end,
            property.key.text === "piety_cost"
              ? tenets.has(value)
                ? "rite_has_tenet"
                : "rite_has_doctrine"
              : "has_tenet"
          );
        if (key.startsWith("doctrine:") && tenets.has(key.slice(9))) {
          if (
            property.key.text !== "can_pick" ||
            children(statement).length !== 1 ||
            scalar(field(statement, "is_in_list")) !== "selected_doctrines"
          )
            w.fail(
              `tenet-selection:${def.id}:${statement.range.start}`,
              "This doctrine scope has more than an unambiguous UI-selection list check. Convert it manually.",
              def,
              statement.range.start
            );
          else {
            local(statement.key.range.start, statement.key.range.end, `flag:${key.slice(9)}`);
            const valueNode = field(statement, "is_in_list")!.value!;
            local(valueNode.range.start, valueNode.range.end, "selected_tenets");
          }
        }
        // A cost is now rooted in Rite. Faith-only conditions must traverse its faith.
        if (property.key.text === "piety_cost") {
          const nestedScope = ancestors.some(
            (a) =>
              a.kind === "assignment" &&
              !["if", "else_if", "else", "limit", "OR", "AND", "NOT", "NOR", "NAND"].includes(a.key.text)
          );
          if (key === "religion_tag" && value && !nestedScope)
            local(statement.range.start, statement.range.end, `faith = { religion = religion:${value} }`);
          else if (
            [
              "value",
              "add",
              "multiply",
              "divide",
              "min",
              "max",
              "if",
              "else_if",
              "else",
              "limit",
              "OR",
              "AND",
              "NOT",
              "NOR",
              "NAND",
              "has_tenet",
            ].includes(key) ||
            (key === "has_doctrine" && value)
          ) {
            /* Arithmetic and documented Rite tenet checks preserve their meaning. */
          } else
            w.fail(
              `tenet-cost-scope:${def.id}:${statement.range.start}`,
              `Cost operation ${key} needs a Rite-root scope review. Resolve it manually before migration.`,
              def,
              statement.range.start
            );
        } else if (key === "religion_tag" && value)
          local(statement.range.start, statement.range.end, `religion = religion:${value}`);
      });
    }
    const edited = editText(
      def.text,
      edits.map((edit) => ({
        ...edit,
        start: edit.start + def.node.range.start,
        end: edit.end + def.node.range.start,
      }))
    );
    const delta = edits.reduce((sum, edit) => sum + edit.text.length - (edit.end - edit.start), 0);
    const text = resolveFileConstants(edited, def.node.range.start, def.node.range.end + delta);
    w.creates.set(`common/religion/tenet_types/px_migrated_${def.id}.txt`, text + "\n");
    w.addEdit(def.path, { ...def.node.range, text: "" });
  }
}
