import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { discoverMods, modInFolder } from "../src/modProjects/discover";

const roots: string[] = [];
async function scratch() {
  const parent = path.resolve(".local/testing");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "mod-discovery-"));
  roots.push(root);
  return root;
}
async function mod(folder: string, name: string) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "descriptor.mod"), `name="${name}"\n`);
}
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("local mod discovery", () => {
  it("finds local mods, project content and launcher pointers without traversing unrelated folders", async () => {
    const root = await scratch();
    const launcher = path.join(root, "user/mod");
    const projects = path.join(root, "projects");
    await mod(path.join(launcher, "local"), "Local Mod");
    await mod(path.join(projects, "Project/mod"), "Project Mod");
    const external = path.join(root, "external");
    await mod(external, "External Mod");
    await fs.writeFile(path.join(launcher, "external.mod"), 'path="../external"\n');
    // A relative launcher path starts at user/, not user/mod/.
    await fs.writeFile(
      path.join(launcher, "project.mod"),
      `path="${path.join(projects, "Project/mod").replaceAll("\\", "/")}"\n`
    );
    await mod(path.join(projects, "unrelated/deep/mod"), "Not Scanned");
    const result = await discoverMods([
      { folder: projects, label: "Projects" },
      { folder: launcher, label: "Game", launcher: true },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.mods.map((item) => item.name)).toEqual(["External Mod", "Local Mod", "Project Mod"]);
    expect(result.mods.find((item) => item.name === "Project Mod")?.folder).toBe(
      path.join(projects, "Project")
    );
  });

  it("accepts metadata projects and directory links but excludes game data and Steam-managed copies", async () => {
    const root = await scratch();
    const mods = path.join(root, "mods");
    const metadata = path.join(mods, "metadata/.metadata");
    await fs.mkdir(metadata, { recursive: true });
    await fs.writeFile(
      path.join(metadata, "metadata.json"),
      JSON.stringify({ name: "Metadata Mod", id: "metadata", version: "1" })
    );
    const external = path.join(root, "external");
    await mod(external, "Linked Mod");
    await fs.symlink(external, path.join(mods, "link"), process.platform === "win32" ? "junction" : "dir");
    const vanilla = path.join(mods, "vanilla");
    await fs.mkdir(path.join(vanilla, "common"), { recursive: true });
    await fs.writeFile(path.join(vanilla, "checksum_manifest.txt"), "fixture");
    const workshop = path.join(root, "steamapps/workshop/content/123/456");
    await mod(workshop, "Subscription");
    await fs.symlink(
      workshop,
      path.join(mods, "subscription"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const result = await discoverMods([{ folder: mods, label: "Game" }]);
    expect(result.mods.map((item) => item.name)).toEqual(["Linked Mod", "Metadata Mod"]);
    expect(await modInFolder(vanilla)).toBeNull();
    const subscriptions = await discoverMods([
      { folder: path.dirname(workshop), label: "Workshop", workshop: true },
    ]);
    expect(subscriptions.mods.map((item) => item.name)).toEqual(["Subscription"]);
  });

  it("reports unreadable locations separately from absent folders and tolerates broken launcher links", async () => {
    const root = await scratch();
    const notDirectory = path.join(root, "file");
    await fs.writeFile(notDirectory, "not a directory");
    await fs.writeFile(path.join(root, "broken.mod"), 'path="not-present"\n');
    const result = await discoverMods([
      { folder: notDirectory, label: "Broken" },
      { folder: path.join(root, "missing"), label: "Absent" },
      { folder: root, label: "Game", launcher: true },
    ]);
    expect(result.mods).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain(notDirectory);
  });
});
