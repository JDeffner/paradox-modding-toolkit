import { walkStatements } from "../../../parser/cst";
import type { BlockNode, ScalarNode } from "../../../parser/cst";
import type { FaithWork, Definition } from "./faithConversion";
import { assignments, scalar } from "./faithSyntax";

/** Consumer edits use CST scalar ranges; quoted prose and comments never receive global substitutions. */
export function convertFaithConsumers(
  w: FaithWork,
  old: Map<string, Definition>,
  parents: Map<string, string>,
  tenets: Set<string>
): void {
  const mapped = [...parents.keys()];
  for (const path of w.context
    .list("mod")
    .filter((p) => /\.(txt|gui|asset|yml)$/i.test(p))
    .sort()) {
    if (
      path.startsWith("common/religion/religion_types/") ||
      path.startsWith("common/religion/doctrine_types/") ||
      path.startsWith("common/religion/tenet_types/")
    )
      continue;
    const text = w.context.readText("mod", path);
    if (text === undefined) {
      w.fail(`unreadable:mod:${path}`, "Cannot read a captured consumer. Restore it before conversion.", {
        path,
      });
      continue;
    }
    if (path.endsWith(".yml")) {
      // IDs remain stable, including localization keys. Scope expressions are a different language.
      for (const id of mapped)
        if (
          new RegExp(
            `\\[[^\\]\\r\\n]*(?:faith:${escapeRegex(id)}|GetFaithByKey\\(['"]${escapeRegex(id)}['"])`
          ).test(text)
        )
          w.fail(
            `localization-reference:${path}:${id}`,
            `Localization expression refers to converted rite ${id}. Update its typed scope expression manually; its localization keys can stay unchanged.`,
            { path }
          );
      continue;
    }
    const parsed = w.parse(text);
    if (parsed.errors.length) {
      w.fail(`consumer-syntax:${path}`, "Repair structural errors before scanning religious consumers.", {
        path,
      });
      continue;
    }
    const historyId = path.startsWith("history/faiths/")
      ? path.slice(path.lastIndexOf("/") + 1, -4)
      : undefined;
    // Installed 1.20 history/faiths/00_christianity.txt groups dates under faith keys,
    // although _faith_history.info still describes filename-owned history.
    if (historyId) {
      const convertedOwners = assignments(parsed.root.statements).filter(
        (node) => node.value?.kind === "block" && parents.has(node.key.text)
      );
      if (convertedOwners.length) {
        for (const owner of convertedOwners)
          w.fail(
            `grouped-history-owner:${path}:${owner.key.text}`,
            `Grouped history still belongs to converted faith ${owner.key.text}. Merge its dated faith-wide behavior into ${parents.get(owner.key.text)} manually, preserving sibling rites and conflicting dates.`,
            { path },
            owner.range.start
          );
        continue;
      }
    }
    if (historyId && parents.has(historyId)) {
      // A faith history filename owns every dated assignment in it. Changing it can affect sibling rites.
      const parent = parents.get(historyId)!;
      const choice = w.ask(
        `history:${historyId}:owner`,
        `Owner of dated history for ${historyId}`,
        [{ value: "parent", label: `Transfer dated faith-wide history to ${parent}` }],
        "Review each date: religious heads and main rites become parent-faith behavior. Existing parent history requires a manual date-by-date merge."
      );
      const destination = `history/faiths/${parent}.txt`;
      const groupedParent = [
        ...new Set([
          ...w.context.list("mod", "history/faiths"),
          ...w.context.list("target", "history/faiths"),
        ]),
      ].find((candidate) => {
        if (!candidate.endsWith(".txt")) return false;
        const effective = w.context.readText("mod", candidate) ?? w.context.readText("target", candidate);
        return (
          effective !== undefined &&
          assignments(w.parse(effective).root.statements).some(
            (node) => node.key.text === parent && node.value?.kind === "block"
          )
        );
      });
      if (
        w.context.readBytes("mod", destination) !== undefined ||
        w.context.readBytes("target", destination) !== undefined ||
        w.creates.has(destination) ||
        groupedParent
      )
        w.fail(
          `history-collision:${historyId}`,
          `Dated history for ${parent} already exists. Merge ${path} into ${groupedParent ?? destination} by date manually, preserving main-rite and DLC assignments.`,
          { path }
        );
      else if (choice === "parent") {
        // The body already uses dated faith-history grammar. No lost ownership or invented bookmark dates.
        w.creates.set(destination, text.replace(/^\uFEFF/, ""));
        w.addEdit(path, {
          start: 0,
          end: text.length,
          text: "\uFEFF# Dated history moved to the selected parent faith.\n",
        });
      }
      continue;
    }
    walkStatements(parsed.root, (statement, ancestors) => {
      if (statement.kind !== "assignment") {
        if (
          statement.value.kind === "scalar" &&
          mapped.some(
            (id) =>
              statement.value.kind === "scalar" &&
              (statement.value.text === `faith:${id}` || statement.value.text.startsWith(`faith:${id}.`))
          )
        )
          w.fail(
            `scope-list-reference:${path}:${statement.range.start}`,
            "A list contains a converted Faith scope. Resolve the list's Faith/Rite element contract manually.",
            { path },
            statement.range.start
          );
        return;
      }
      const node = statement;
      // _rite_types.info defines this field as a parent Faith database key, not a comparison.
      if (
        path.startsWith("common/religion/rite_types/") &&
        node.key.text === "faith" &&
        ancestors.filter((ancestor) => ancestor.kind === "assignment").length === 1 &&
        parents.has(scalar(node) ?? "")
      ) {
        const id = scalar(node)!,
          parent = parents.get(id)!;
        const choice = w.ask(
          `reference:${path}:${node.value!.range.start}`,
          `Parent faith of this existing rite in ${path}`,
          [{ value: "faith", label: `Reparent to faith ${parent}` }],
          `A rite cannot belong to another rite. Reparenting changes its inherited behavior; keep ${id} independent to retain it as the parent.`
        );
        if (choice === "faith") w.addEdit(path, { ...node.value!.range, text: parent });
        return;
      }
      const scopeNodes = [node.key, ...(node.value?.kind === "scalar" ? [node.value] : [])];
      const handled = new Set<ScalarNode>();
      for (const token of scopeNodes) {
        if (mapped.some((id) => token.text.startsWith(`faith:${id}.`)))
          w.fail(
            `scope-chain-reference:${path}:${token.range.start}`,
            "A scope chain starts at a converted faith. Resolve the chained Faith/Rite operations manually.",
            { path },
            token.range.start
          );
        const match = /^faith:([^.$[\]]+)$/.exec(token.text);
        if (!match || !parents.has(match[1])) continue;
        const id = match[1],
          parent = parents.get(id)!;
        const choice = w.ask(
          `reference:${path}:${token.range.start}`,
          `Meaning of ${id} at ${path}:${token.range.start}`,
          [
            { value: "rite", label: `Exact rite ${id}` },
            { value: "faith", label: `Whole parent faith ${parent}` },
          ],
          "Scope type changes can affect the containing effect or trigger. Supported comparisons are updated together; unsupported typed operations need manual review."
        );
        handled.add(token);
        if (!choice) continue;
        const exact = choice === "rite";
        if (token === node.key && node.value?.kind === "block") {
          // A literal scope switch is valid; only members supported on Rite can be retained.
          if (exact) {
            const unsupported: string[] = [];
            walkStatements(node.value, (child) => {
              if (
                child.kind === "assignment" &&
                ![
                  "has_tenet",
                  "has_doctrine",
                  "exists",
                  "save_scope_as",
                  "save_temporary_scope_as",
                  "NOT",
                  "AND",
                  "OR",
                  "NOR",
                  "NAND",
                ].includes(child.key.text)
              )
                unsupported.push(child.key.text);
            });
            if (unsupported.length) {
              w.fail(
                `typed-scope:${path}:${node.range.start}`,
                `Exact rite scope contains ${unsupported.join(", ")}. Verify these operations against target script_docs and edit them manually.`,
                { path },
                node.range.start
              );
              continue;
            }
          }
        } else if (token === node.value) {
          if (node.key.text === "faith") {
            if (exact) w.addEdit(path, { ...node.key.range, text: "rite" });
          } else if (!["exists"].includes(node.key.text)) {
            w.fail(
              `typed-reference:${path}:${node.range.start}`,
              `Operation ${node.key.text} consumes ${token.text}. Resolve its Faith/Rite contract manually before conversion.`,
              { path },
              node.range.start
            );
            continue;
          }
        }
        w.addEdit(path, { ...token.range, text: `${exact ? "rite" : "faith"}:${exact ? id : parent}` });
      }
      const value = scalar(node);
      if (value && parents.has(value) && !handled.has(node.value as ScalarNode)) {
        const id = value,
          parent = parents.get(id)!;
        const isCharacter = path.startsWith("history/characters/");
        const isProvince = path.startsWith("history/provinces/");
        if ((isCharacter || isProvince) && ["faith", "religion", "rite"].includes(node.key.text)) {
          // Character religion=<faith> is a supported compatibility form. Converted communities need rite assignment.
          const choice = w.ask(
            `reference:${path}:${node.value!.range.start}`,
            `Assignment of ${id} in ${path}`,
            [
              { value: "rite", label: `Assign exact rite ${id}` },
              { value: "faith", label: `Assign ${parent}'s main rite` },
            ]
          );
          if (choice === "rite") {
            const owner = [...ancestors].reverse().find((a) => a.kind === "block") as BlockNode | undefined;
            const siblings = owner ? assignments(owner.statements) : assignments(parsed.root.statements);
            const other = siblings.filter(
              (n) => n !== node && ["faith", "religion", "rite"].includes(n.key.text)
            );
            if (other.length) {
              w.fail(
                `history-assignment-conflict:${path}:${node.range.start}`,
                "This dated history block already has another faith or rite assignment. Resolve their order and fallback together.",
                { path },
                node.range.start
              );
              return;
            }
            if (isProvince) w.addEdit(path, { ...node.range, text: `faith = ${parent}\nrite = ${id}` });
            else w.addEdit(path, { ...node.key.range, text: "rite" });
          } else if (choice === "faith") w.addEdit(path, { ...node.value!.range, text: parent });
        } else if (node.key.text === "main_rite") {
          // The kept ID now identifies a scripted rite. Its dated owner must agree.
          if (historyId && historyId !== parent)
            w.fail(
              `history-owner:${path}:${id}`,
              `${path} assigns ${id} to a faith other than selected parent ${parent}. Resolve dated ownership before conversion.`,
              { path },
              node.range.start
            );
        } else if (node.key.text === "faith") {
          const choice = w.ask(
            `reference:${path}:${node.value!.range.start}`,
            `Meaning of ${id} in ${path}`,
            [
              { value: "rite", label: `Exact rite ${id}` },
              { value: "faith", label: `Whole faith ${parent}` },
            ]
          );
          if (choice === "faith") w.addEdit(path, { ...node.value!.range, text: parent });
          else if (choice === "rite") w.addEdit(path, { ...node.key.range, text: "rite" });
        } else if (!["icon", "name", "desc", "text"].includes(node.key.text))
          w.fail(
            `bare-reference:${path}:${node.range.start}`,
            `Possible ${id} consumer in ${node.key.text}. Resolve its intended target type manually.`,
            { path },
            node.range.start
          );
      }
      const exactRiteScope = ancestors.some(
        (ancestor) =>
          ancestor.kind === "assignment" &&
          ancestor.key.text.startsWith("faith:") &&
          parents.has(ancestor.key.text.slice(6)) &&
          w.answers[`reference:${path}:${ancestor.key.range.start}`] === "rite"
      );
      if (exactRiteScope && ["has_doctrine", "has_tenet"].includes(node.key.text) && value)
        w.addEdit(path, {
          ...node.key.range,
          text: tenets.has(value) ? "rite_has_tenet" : "rite_has_doctrine",
        });
      else if (node.key.text === "has_doctrine" && value && tenets.has(value))
        w.addEdit(path, { ...node.key.range, text: "has_tenet" });
      for (const token of scopeNodes) {
        if (token.quoted && token.text.includes("[") && mapped.some((id) => token.text.includes(id)))
          w.fail(
            `dynamic-reference:${path}:${token.range.start}`,
            "Typed GUI or dynamic expression refers to a converted faith. Review and update it manually.",
            { path },
            token.range.start
          );
        if (mapped.length && /faith:.*(?:\$|\[)|^faith:\$/.test(token.text))
          w.fail(
            `dynamic-reference:${path}:${token.range.start}`,
            "Computed faith reference may select a converted rite. Resolve it manually or provide an explicit static reference.",
            { path },
            token.range.start
          );
      }
      if (node.value?.kind === "block")
        for (const entry of node.value.statements)
          if (entry.kind === "value" && entry.value.kind === "scalar" && parents.has(entry.value.text))
            w.fail(
              `list-reference:${path}:${entry.range.start}`,
              `List ${node.key.text} contains converted faith ${entry.value.text}. Resolve the list's required scope type manually.`,
              { path },
              entry.range.start
            );
    });
  }
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
