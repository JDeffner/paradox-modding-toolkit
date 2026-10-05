/** Two version components cover all patches; an explicit patch remains exact. */
export function legacyVersion(input: string): { key: string; supportedVersion: string } {
  const value = input.trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}(?:\.\*)?$/.test(value))
    throw new Error("Enter a game version such as 1.19.* or an exact version such as 1.19.2.");
  const supportedVersion = /^\d+\.\d+$/.test(value) ? `${value}.*` : value;
  return { key: supportedVersion.replace(/\.\*$/, ""), supportedVersion };
}
