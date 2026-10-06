import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.resolve("scripts/discord-release-message.mjs");
const stableRole = "1534329963933864079";
const prereleaseRole = "1534329963933864080";
let cwd: string;

function run(env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [script], {
    cwd,
    env: {
      ...process.env,
      RELEASE_TAG: "v0.5.5",
      GITHUB_REPOSITORY: "JDeffner/paradox-modding-toolkit",
      PRERELEASE: "false",
      DISCORD_STABLE_ROLE_ID: stableRole,
      DISCORD_PRERELEASE_ROLE_ID: prereleaseRole,
      ...env,
    },
    encoding: "utf8",
  });
}

interface Payload {
  content: string;
  allowed_mentions: { parse: string[]; users: string[]; roles: string[] };
}

function payload(env: Record<string, string | undefined> = {}): Payload {
  const result = run(env);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Payload;
}

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "px-discord-release-test-"));
  writeFileSync(path.join(cwd, "release-body.md"), "- Preserve edits.\n");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("Discord release payload", () => {
  it("announces stable releases with only the stable role", () => {
    const result = payload({ DISCORD_PRERELEASE_ROLE_ID: undefined });
    expect(result.content).toContain(`<@&${stableRole}> **Paradox Toolkit v0.5.5** is out.`);
    expect(result.content).not.toContain("prerelease");
    expect(result.allowed_mentions).toEqual({ parse: [], users: [], roles: [stableRole] });
    expect(result.content).toContain("/blob/v0.5.5/packages/vscode/CHANGELOG.md>");
  });

  it("announces prereleases with only the dedicated prerelease role", () => {
    const result = payload({ PRERELEASE: "true" });
    expect(result.content).toContain(
      `<@&${prereleaseRole}> **Paradox Toolkit v0.5.5 prerelease** is ready to test.`
    );
    expect(result.content).not.toContain(stableRole);
    expect(result.allowed_mentions).toEqual({ parse: [], users: [], roles: [prereleaseRole] });
  });

  it("uses the brief notes and appends its changelog link only once", () => {
    writeFileSync(
      path.join(cwd, "release-body.md"),
      `- Preserve edits.\n\n### Full changelog\n[Server](https://example.org/server)\n${"Detailed links.\n".repeat(200)}`
    );
    const result = payload({ PRERELEASE: "true" });
    expect(result.content).toContain("- Preserve edits.\n\nRelease:");
    expect(result.content).not.toContain("### Full changelog");
    expect(result.content).not.toContain("https://example.org/server");
    expect(result.content.match(/Full changelog:/g)).toHaveLength(1);
    expect(result.content.length).toBeLessThanOrEqual(2000);
  });

  it("does not authorize mentions embedded in release notes", () => {
    writeFileSync(
      path.join(cwd, "release-body.md"),
      `@everyone @here <@123456789012345678> <@&${stableRole}>`
    );
    expect(payload({ PRERELEASE: "true" }).allowed_mentions).toEqual({
      parse: [],
      users: [],
      roles: [prereleaseRole],
    });
  });

  it.each([undefined, "", "role-name", "123", stableRole])(
    "rejects missing, invalid or reused prerelease role %j without a stable fallback",
    (role) => {
      const result = run({ PRERELEASE: "true", DISCORD_PRERELEASE_ROLE_ID: role });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Discord role");
    }
  );

  it("rejects an invalid stable role", () => {
    expect(run({ DISCORD_STABLE_ROLE_ID: "" }).status).not.toBe(0);
  });

  it.each(["", "yes", "TRUE"])("rejects ambiguous prerelease input %j", (value) => {
    expect(run({ PRERELEASE: value }).status).not.toBe(0);
  });

  it.each([
    ["true", "next"],
    ["false", "latest"],
  ])("maps workflow prerelease input %s to npm tag %s", (input, tag) => {
    const result = spawnSync(process.execPath, [path.resolve("scripts/release-channel.mjs")], {
      env: { ...process.env, PRERELEASE: input },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(tag);
  });

  it("keeps long Unicode notes within Discord's limit without splitting a character", () => {
    writeFileSync(path.join(cwd, "release-body.md"), `\uFEFF${"é🐉".repeat(1500)}`);
    const result = payload({ PRERELEASE: "true" });
    expect(result.content.length).toBeLessThanOrEqual(2000);
    expect(result.content).toContain("\n…\n\nRelease:");
    expect(result.content).not.toContain("\uFFFD");
    expect(result.content).toBe(Buffer.from(result.content, "utf8").toString("utf8"));
  });

  it("cuts long multiline notes after a complete line", () => {
    const line = "- Preserve unsaved localization and script changes.\n";
    writeFileSync(path.join(cwd, "release-body.md"), line.repeat(100));
    const result = payload();
    expect(result.content).toMatch(/changes\.\n…\n\nRelease:/);
    expect(result.content.length).toBeLessThanOrEqual(2000);
  });

  it("rejects empty notes before producing a payload", () => {
    writeFileSync(path.join(cwd, "release-body.md"), " \n");
    expect(run().status).not.toBe(0);
  });

  it("uses the actual workflow channel input and sends the built payload only", () => {
    const workflow = readFileSync(path.resolve(".github/workflows/release.yml"), "utf8");
    const announcement =
      workflow.split("- name: Announce on Discord")[1]?.split("# Package versions")[0] ?? "";
    expect(announcement).toContain("PRERELEASE: ${{ inputs.prerelease }}");
    expect(announcement).toContain("DISCORD_PRERELEASE_ROLE_ID: ${{ vars.DISCORD_PRERELEASE_ROLE_ID }}");
    expect(announcement).toContain("node scripts/discord-release-message.mjs > discord-release-payload.json");
    expect(announcement).toContain("--data-binary @discord-release-payload.json");
    expect(readFileSync(script, "utf8")).not.toMatch(/fetch\(|https\.request|curl /);
    const npm = workflow.split("- name: Publish npm packages")[1] ?? "";
    expect(npm).toContain("PRERELEASE: ${{ inputs.prerelease }}");
    expect(npm).toContain("NPM_TAG=$(node scripts/release-channel.mjs)");
    expect(npm).toContain('--tag "$NPM_TAG"');
  });
});
