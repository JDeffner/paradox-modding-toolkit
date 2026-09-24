import { build } from "esbuild";
import { cp, mkdir, chmod, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = path.join(root, "packages/cli");
const dist = path.join(pkg, "dist");
await mkdir(dist, { recursive: true });
const cli = await build({
  absWorkingDir: root,
  entryPoints: ["packages/cli/src/main.ts"],
  outfile: path.join(dist, "pxtk.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  metafile: true,
  external: ["sharp"],
  banner: { js: "#!/usr/bin/env node" },
});
const lsp = await build({
  absWorkingDir: root,
  entryPoints: ["packages/server/src/server.ts"],
  outfile: path.join(dist, "lsp/server.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  metafile: true,
});
await cp(path.join(root, "packages/server/data"), path.join(dist, "data"), { recursive: true });
await cp(path.join(root, "packages/server/media"), path.join(dist, "media"), { recursive: true });
await cp(path.join(root, "LICENSE"), path.join(pkg, "LICENSE"));
await cp(path.join(root, "THIRD-PARTY-NOTICES.md"), path.join(pkg, "THIRD-PARTY-NOTICES.md"));
// Ship license texts for every package whose code esbuild included, including
// transitive dependencies. Native sharp stays an installed runtime dependency.
const dependencies = new Map();
for (const file of [...Object.keys(cli.metafile.inputs), ...Object.keys(lsp.metafile.inputs)]) {
  if (!file.replaceAll("\\", "/").includes("node_modules/")) continue;
  let dir = path.dirname(path.resolve(root, file));
  while (dir !== path.dirname(dir)) {
    let metadata;
    try {
      metadata = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (metadata?.name) {
      dependencies.set(metadata.name, {
        dir,
        name: metadata.name,
        version: metadata.version,
        license: metadata.license,
      });
      break;
    }
    dir = path.dirname(dir);
  }
}
const licenses = path.join(dist, "licenses");
await mkdir(licenses, { recursive: true });
for (const dependency of dependencies.values()) {
  const files = (await readdir(dependency.dir)).filter((name) =>
    /^(license|licence|copying)(\.|$)/i.test(name)
  );
  if (!files.length) throw new Error(`No license file for bundled dependency ${dependency.name}`);
  const target = path.join(licenses, dependency.name.replaceAll("/", "__"));
  await mkdir(target, { recursive: true });
  for (const file of files) await cp(path.join(dependency.dir, file), path.join(target, file));
}
await writeFile(
  path.join(licenses, "dependencies.json"),
  JSON.stringify(
    [...dependencies.values()].map(({ name, version, license }) => ({ name, version, license })),
    null,
    2
  ) + "\n"
);
await chmod(path.join(dist, "pxtk.cjs"), 0o755);
