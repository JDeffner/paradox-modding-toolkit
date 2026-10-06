/** Browser-safe identity for the decoded source behind event-detail coordinates. */
export function eventSourceHash(text: string): string {
  text = text.replace(/^\uFEFF/, "");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${text.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}
