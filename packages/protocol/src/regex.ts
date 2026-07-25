/**
 * One correct copy of the regex-escape both sides need. It lived inline at five
 * call sites and one of them had an extra backslash, which silently turned the
 * escape into a no-op (it matched a metacharacter followed by two literal
 * backslashes, so nothing was ever escaped).
 */

/** Escape every regex metacharacter in `literal` so it matches itself. */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A pattern matching `name` only as a whole script identifier: not when it is
 * a substring of a longer name, and not across a dot-chain segment boundary.
 */
export function wholeNamePattern(name: string): string {
  return `(?<![A-Za-z0-9_.\\-])${escapeRegExp(name)}(?![A-Za-z0-9_.\\-])`;
}
