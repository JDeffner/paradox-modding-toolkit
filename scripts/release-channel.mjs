import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

/** The manual workflow input controls both Marketplace and npm audiences. */
export function releaseChannel(value) {
  if (value !== "true" && value !== "false") {
    throw new Error("PRERELEASE must be true or false");
  }
  const prerelease = value === "true";
  return { prerelease, npmTag: prerelease ? "next" : "latest" };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  process.stdout.write(`${releaseChannel(process.env.PRERELEASE).npmTag}\n`);
}
