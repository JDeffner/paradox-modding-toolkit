/**
 * What an upload would trip over, read from the local files alone: Steam's
 * hard limits (title 128 bytes, description 8000 bytes, preview under 1 MB)
 * and the things that make a listing look abandoned (no preview, no text,
 * no tags, a game version the launcher will flag). Errors block the upload
 * in the panel; warnings only show.
 *
 * No vscode imports: unit-tested in plain Node.
 */

export interface PreflightCheck {
  level: "error" | "warn";
  message: string;
}

export const TITLE_MAX_BYTES = 128;
export const DESCRIPTION_MAX_BYTES = 8000;
export const PREVIEW_MAX_BYTES = 1024 * 1024;

export interface PreflightInput {
  name: string | null;
  description: string;
  tags: string[];
  previewPath: string | null;
  /** Size of the preview image, or null when there is none or it is unreadable. */
  previewBytes: number | null;
  supportedVersion: string | null;
  /** The installed game's version, when known. */
  gameVersion: string | null;
}

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

/**
 * True when `supported` (a descriptor value, wildcard `*` allowed per
 * segment) covers `game` (the installed version). "1.19.*" covers "1.19.0.6";
 * "1.18.0" does not.
 */
export function supportsGameVersion(supported: string, game: string): boolean {
  const s = supported.trim().split(".");
  const g = game.trim().split(".");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "*") return true;
    if (s[i] !== (g[i] ?? "")) return false;
  }
  return true;
}

export function preflight(input: PreflightInput): PreflightCheck[] {
  const out: PreflightCheck[] = [];
  const title = (input.name ?? "").trim();
  if (title === "")
    out.push({ level: "error", message: "The descriptor has no name, so the item has no title." });
  else if (bytes(title) > TITLE_MAX_BYTES)
    out.push({ level: "error", message: `The title is over Steam's ${TITLE_MAX_BYTES}-byte limit.` });
  if (bytes(input.description) > DESCRIPTION_MAX_BYTES)
    out.push({
      level: "error",
      message: `The description is over Steam's ${DESCRIPTION_MAX_BYTES}-byte limit (${bytes(input.description)} bytes).`,
    });
  if (input.previewPath && input.previewBytes !== null && input.previewBytes >= PREVIEW_MAX_BYTES)
    out.push({ level: "error", message: "The preview image is 1 MB or larger; Steam rejects it." });
  if (!input.previewPath)
    out.push({ level: "warn", message: "No preview image. The item shows a blank tile." });
  if (input.description.trim() === "") out.push({ level: "warn", message: "The description is empty." });
  if (input.tags.length === 0)
    out.push({ level: "warn", message: "No tags. The item is hard to find by category." });
  if (
    input.supportedVersion &&
    input.gameVersion &&
    !supportsGameVersion(input.supportedVersion, input.gameVersion)
  )
    out.push({
      level: "warn",
      message: `The supported game version "${input.supportedVersion}" does not cover the installed ${input.gameVersion}.`,
    });
  return out;
}
