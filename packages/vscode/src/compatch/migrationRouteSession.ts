import type { MigrationManifest, MigrationRoute, MigrationSession } from "@px-lsp/protocol/migration";

export function entryCompleted(session: MigrationSession, entry: MigrationManifest): boolean {
  return session.completions[entry.id]?.revision === entry.revision;
}

/** Dependencies and required earlier steps are separate from permission to read a note. */
export function entryBlock(
  session: MigrationSession,
  catalog: MigrationManifest[],
  route: MigrationRoute | undefined,
  entry: MigrationManifest
): string | undefined {
  if (!route?.entryIds.includes(entry.id)) return "Select a route containing this entry first.";
  for (const id of entry.dependsOn) {
    const dependency = catalog.find((item) => item.id === id);
    if (!dependency || !entryCompleted(session, dependency))
      return `Resolve prerequisite ${dependency?.title ?? id} first.`;
  }
  const position = route.entryIds.indexOf(entry.id);
  for (const id of route.entryIds.slice(0, position)) {
    const previous = catalog.find((item) => item.id === id);
    if (
      previous?.requirement === "required" &&
      (previous.fromVersion !== entry.fromVersion || previous.toVersion !== entry.toVersion) &&
      !entryCompleted(session, previous)
    )
      return `Resolve earlier required entry ${previous.title} first.`;
  }
  return undefined;
}

export function clearDownstream(
  session: MigrationSession,
  route: MigrationRoute | undefined,
  id: string
): void {
  const position = route?.entryIds.indexOf(id) ?? -1;
  const ids = position < 0 ? Object.keys(session.completions) : route!.entryIds.slice(position);
  for (const entryId of ids) delete session.completions[entryId];
  session.checkpoint = undefined;
}

export function mergeMigrationCatalog(
  builtin: MigrationManifest[],
  local: MigrationSession["localEntries"]
): MigrationManifest[] {
  const catalog = [...builtin, ...local.map((item) => item.manifest)];
  const seen = new Set<string>();
  for (const entry of catalog) {
    if (seen.has(entry.id))
      throw new Error(`Duplicate migration library ID: ${entry.id}. Use a unique ID in each contribution.`);
    seen.add(entry.id);
  }
  return catalog;
}
