import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { releaseChannel } from "./release-channel.mjs";

const MAX_CONTENT_LENGTH = 2000;

function shortenNotes(notes, limit) {
  if (notes.length <= limit) return notes;
  let cut = "";
  for (const character of notes) {
    if (cut.length + character.length > limit - 2) break;
    cut += character;
  }
  const newline = cut.lastIndexOf("\n");
  if (newline > 0) cut = cut.slice(0, newline);
  return `${cut.trimEnd()}\n…`;
}

/** Build the payload only. Posting remains an explicit workflow step. */
export function buildDiscordReleaseMessage({
  tag,
  repository,
  prerelease,
  stableRoleId,
  prereleaseRoleId,
  notes,
}) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) throw new Error("Invalid release tag");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Invalid repository");
  if (typeof prerelease !== "boolean") throw new Error("Prerelease must be true or false");
  const role = prerelease ? prereleaseRoleId : stableRoleId;
  if (!/^\d{17,20}$/.test(role ?? "")) {
    throw new Error(`Missing or invalid ${prerelease ? "prerelease" : "stable"} Discord role`);
  }
  if (prerelease && role === stableRoleId) {
    throw new Error("The prerelease Discord role must differ from the stable role");
  }
  if (typeof notes !== "string") throw new Error("Release notes are required");
  const summary = notes
    .replace(/^\uFEFF/, "")
    .replace(/^### Full changelog\b[\s\S]*/m, "")
    .trim();
  if (!summary) throw new Error("Release notes are required");
  const heading = prerelease
    ? `**Paradox Toolkit ${tag} prerelease** is ready to test.`
    : `**Paradox Toolkit ${tag}** is out.`;
  const prefix = `<@&${role}> ${heading}\n\n`;
  const suffix = `\n\nRelease: <https://github.com/${repository}/releases/tag/${tag}>\nFull changelog: <https://github.com/${repository}/blob/${tag}/packages/vscode/CHANGELOG.md>`;
  const body = shortenNotes(summary, MAX_CONTENT_LENGTH - prefix.length - suffix.length);
  return {
    content: `${prefix}${body}${suffix}`,
    allowed_mentions: { parse: [], users: [], roles: [role] },
  };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const { prerelease } = releaseChannel(process.env.PRERELEASE);
  const payload = buildDiscordReleaseMessage({
    tag: process.env.RELEASE_TAG,
    repository: process.env.GITHUB_REPOSITORY,
    prerelease,
    stableRoleId: process.env.DISCORD_STABLE_ROLE_ID,
    prereleaseRoleId: process.env.DISCORD_PRERELEASE_ROLE_ID,
    notes: readFileSync("release-body.md", "utf8"),
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
