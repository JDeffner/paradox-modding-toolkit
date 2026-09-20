import type { GameProfile } from "../games/profile";
import { EVENT_ID } from "../index/extract";
import { nodeAtOffset, type AssignmentNode, type BlockNode, type ParseResult } from "../parser";

type BlockAssignment = AssignmentNode & { value: BlockNode };

/** Proposes a name only; accepting it does not define localization or write a file. */
export function eventLocalizationKey(
  parse: ParseResult,
  offset: number,
  key: string,
  convention: GameProfile["eventLocalization"]
): string | undefined {
  if (!convention) return undefined;
  if (key !== "name" && !Object.hasOwn(convention.fields, key)) return undefined;
  if (parse.comments.some((comment) => offset >= comment.range.start && offset <= comment.range.end))
    return undefined;
  const blocks = (nodeAtOffset(parse.root, offset)?.path ?? []).filter(
    (stmt): stmt is BlockAssignment =>
      stmt.kind === "assignment" &&
      stmt.value?.kind === "block" &&
      offset > stmt.value.openBrace &&
      (stmt.value.closeBrace === null || offset <= stmt.value.closeBrace)
  );
  const event = blocks[0];
  if (!event || event.key.quoted || !EVENT_ID.test(event.key.text)) return undefined;
  if (blocks.length === 1) {
    const suffix = convention.fields[key];
    return suffix ? event.key.text + suffix : undefined;
  }
  const option = blocks[1];
  if (blocks.length !== 2 || option.key.text !== "option" || key !== "name") return undefined;
  const options = event.value.statements.filter(
    (stmt): stmt is BlockAssignment =>
      stmt.kind === "assignment" && stmt.key.text === "option" && stmt.value?.kind === "block"
  );
  const used = new Set(
    options
      .filter((stmt) => stmt !== option)
      .flatMap((stmt) =>
        stmt.value.statements.flatMap((field) =>
          field.kind === "assignment" && field.key.text === "name" && field.value?.kind === "scalar"
            ? [field.value.text]
            : []
        )
      )
  );
  // The profile supplies the first letter; stop at z instead of inventing a new scheme.
  const stem = event.key.text + convention.optionSuffix.slice(0, -1);
  const first = convention.optionSuffix.charCodeAt(convention.optionSuffix.length - 1);
  for (let letter = first + options.indexOf(option); letter <= "z".charCodeAt(0); letter++) {
    const candidate = stem + String.fromCharCode(letter);
    if (!used.has(candidate)) return candidate;
  }
  return undefined;
}
