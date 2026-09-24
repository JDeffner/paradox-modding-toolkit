import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { renderLoadModBlocks } from "./tigerLoadMods";

export interface TigerConfigInput {
  modRoot: string;
  configDir: string;
  confName: string;
  descriptor: "mod" | "metadata";
  parentPaths: string[];
  explicitConfig?: string | null;
}

/** Preserve explicit configuration; otherwise load every declared dependency or fail. */
export function prepareTigerConfig(input: TigerConfigInput): {
  args: string[];
  source: string | null;
  text: string;
  dispose: () => void;
} {
  const selected =
    input.explicitConfig ??
    [path.join(input.configDir, input.confName), path.join(input.modRoot, input.confName)].find((file) =>
      fs.existsSync(file)
    );
  if (selected) {
    const text = fs.readFileSync(selected, "utf8");
    return { args: ["--config", selected], source: selected, text, dispose: () => {} };
  }
  const deps = renderLoadModBlocks(input.descriptor, input.parentPaths, input.modRoot);
  if (deps.skipped.length)
    throw new Error(`Tiger dependency descriptors are missing: ${deps.skipped.join(", ")}`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pxtk-tiger-"));
  const file = path.join(directory, input.confName);
  try {
    fs.writeFileSync(file, deps.conf, "utf8");
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    args: ["--config", file],
    source: null,
    text: deps.conf,
    dispose: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}
