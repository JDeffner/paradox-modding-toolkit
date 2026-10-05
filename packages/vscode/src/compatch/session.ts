import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parseScript } from "@px-lsp/server/parser";
import type { GameMeta } from "@px-lsp/server/games/profile";
import {
  addFile,
  contains,
  fingerprint,
  isScannableFile,
  type Entry,
  type Inventory,
  type Session,
  type Side,
  type ReplacementRule,
} from "./core";
import { needsGameUpdate } from "./gameUpdate";

export interface SessionStore {
  version: 2;
  active?: string;
  sessions: Session[];
}
export function identifySession(session: Session): Session {
  session.id ??= createHash("sha256")
    .update(JSON.stringify([session.mode, session.gameId, session.roots, session.output]))
    .digest("hex")
    .slice(0, 24);
  session.name ??= `${path.basename(session.roots.A!)} / ${path.basename(session.roots.B!)} (${session.mode === "game-update" ? "update" : "compare"})`;
  return session;
}
export function readSessionStore(value: unknown): SessionStore {
  const data = value as SessionStore | Session;
  if (data?.version === 1 && "roots" in data) {
    validateReplacementRules(data);
    const session = identifySession(data);
    return { version: 2, active: session.id, sessions: [session] };
  }
  if (data?.version !== 2 || !Array.isArray(data.sessions))
    throw new Error("Invalid saved compatch sessions.");
  for (const session of data.sessions) {
    if (session.version !== 1 || !session.roots || !session.reviews || !session.results)
      throw new Error("Invalid saved compatch session.");
    validateReplacementRules(session);
    identifySession(session);
  }
  return data;
}

function validateReplacementRules(session: Session): void {
  const rules = session.intentionalReplacements;
  if (rules === undefined) return;
  if (
    !Array.isArray(rules) ||
    rules.some(
      (rule) =>
        !rule ||
        (rule.kind !== "file" && rule.kind !== "folder") ||
        typeof rule.path !== "string" ||
        /[\\:]/.test(rule.path) ||
        rule.path.includes("\0") ||
        rule.path.split("/").some((part) => !part || part === "." || part === "..")
    )
  )
    throw new Error("Invalid intentional replacement rule. Use a file or folder path relative to the mod.");
}

export function replacementRulesForPath(session: Session, relative: string): ReplacementRule[] {
  if (session.mode !== "game-update") return [];
  const filename = relative.replaceAll("\\", "/");
  return (session.intentionalReplacements ?? []).filter((rule) =>
    rule.kind === "file" ? filename === rule.path : filename.startsWith(`${rule.path}/`)
  );
}

export function isIntentionalReplacement(entry: Entry, session: Session): boolean {
  return (
    entry.sites.A.length > 0 &&
    entry.sites.A.every((site) => replacementRulesForPath(session, site.path).length > 0)
  );
}

export function assertContentUpdateAllowed(session: Session, relative: string): void {
  if (replacementRulesForPath(session, relative).length)
    throw new Error(
      `Intentional replacement: ${relative}. Remove its replacement rule before applying game content. Target validation remains available.`
    );
}
export const inputKey = (side: Side, relative: string) => JSON.stringify([side, relative]);
export function entryInputs(entry: Entry): { side: Side; relative: string }[] {
  const unique = new Map<string, { side: Side; relative: string }>();
  for (const side of ["A", "B", "base"] as const) {
    for (const site of entry.sites[side])
      unique.set(inputKey(side, site.path), { side, relative: site.path });
    // Re-read missing same-path sides too, so additions cannot be marked from stale evidence.
    if (entry.kind === "file" && !entry.sites[side].length)
      unique.set(inputKey(side, entry.name), { side, relative: entry.name });
  }
  return [...unique.values()];
}

/** Read the requested files first. A failed read leaves the previous inventory intact. */
export async function refreshFiles(
  inventory: Inventory,
  session: Session,
  support: GameMeta["compatch"],
  inputs: { side: Side; relative: string }[]
): Promise<Set<string>> {
  const reads = new Map<string, { side: Side; relative: string; text?: string; issue?: string }>();
  for (const { side, relative } of inputs) {
    const root = session.roots[side];
    if (!root || reads.has(inputKey(side, relative)) || !isScannableFile(relative, session, support))
      continue;
    const file = path.resolve(root, relative);
    if (!contains(root, file)) throw new Error("Source path leaves its selected folder.");
    let text: string | undefined;
    let issue: string | undefined;
    try {
      const realRoot = await fs.realpath(root);
      const realFile = await fs.realpath(file);
      if (!contains(realRoot, realFile))
        throw new Error("Source path follows a link outside its selected folder.");
      const stat = await fs.stat(file);
      if (!stat.isFile()) issue = "not a regular file; skipped.";
      else if (path.relative(path.join(realRoot, relative), realFile)) issue = "symbolic link skipped.";
      else if (stat.size > 8 * 1024 * 1024) issue = "exceeds 8 MiB; skipped.";
      else {
        const bytes = await fs.readFile(file);
        try {
          text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          if (text.includes("\0")) throw new Error("binary");
        } catch {
          text = undefined;
          issue = "not UTF-8 text; skipped.";
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    reads.set(inputKey(side, relative), { side, relative, text, issue });
  }
  const affected = new Set<string>();
  for (const { side, relative, text, issue } of reads.values()) {
    if (issue) {
      inventory.issues = inventory.issues.filter((note) => !note.startsWith(`${side}: ${relative}:`));
      inventory.issues.push(`${side}: ${relative}: ${issue}`);
    }
    if (inventory.files[side].get(relative) === text) continue;
    for (const entry of inventory.entries.values()) {
      if (entry.sites[side].some((site) => site.path === relative)) {
        affected.add(entry.id);
        entry.sites[side] = entry.sites[side].filter((site) => site.path !== relative);
      }
    }
    inventory.files[side].delete(relative);
    if (!issue)
      inventory.issues = inventory.issues.filter((note) => !note.startsWith(`${side}: ${relative}:`));
    if (text !== undefined) addFile(inventory, side, relative, text, support, session.localizationLanguage);
    for (const entry of inventory.entries.values())
      if (entry.sites[side].some((site) => site.path === relative)) affected.add(entry.id);
  }
  if (affected.size) {
    applyRelocations(inventory, session);
    session.tracked = [
      ...new Set([...(session.tracked ?? []), ...queueEntries(inventory, session).map((entry) => entry.id)]),
    ];
  }
  return affected;
}

export function applyRelocations(inventory: Inventory, session: Session): void {
  for (const [id, relative] of Object.entries(session.relocations ?? {})) {
    const entry = inventory.entries.get(id);
    if (!entry || entry.kind !== "file") continue;
    const text = inventory.files.B.get(relative);
    entry.sites.B = text === undefined ? [] : [{ path: relative, line: 1, text }];
  }
}
export function queueState(
  entry: Entry,
  session: Session
): "pending" | "manual" | "reviewed" | "skipped" | "replacement" {
  if (isIntentionalReplacement(entry, session)) return "replacement";
  const review = session.reviews[entry.id];
  if (review && review.fingerprint === fingerprint(entry)) return review.status;
  if (
    session.manual?.includes(entry.id) ||
    Object.values(entry.sites).some((sites) => sites.length > 1) ||
    (session.mode === "game-update" && Object.values(entry.sites).some((sites) => !sites.length))
  )
    return "manual";
  return "pending";
}
export function queueEntries(inventory: Inventory, session: Session): Entry[] {
  const tracked = new Set(session.tracked);
  return [...inventory.entries.values()].filter(
    (entry) =>
      session.mode !== "game-update" ||
      isIntentionalReplacement(entry, session) ||
      needsGameUpdate(entry) ||
      !!session.reviews[entry.id] ||
      tracked.has(entry.id)
  );
}
export function mergeEligible(entry: Entry, session?: Session): boolean {
  return (
    (!session || entry.sites.A.every((site) => !replacementRulesForPath(session, site.path).length)) &&
    (entry.kind === "file" || entry.kind === "event") &&
    Object.values(entry.sites).every((sites) => sites.length === 1)
  );
}
export function recordReview(
  session: Session,
  inventory: Inventory,
  entry: Entry,
  state: "reviewed" | "skipped"
): void {
  const entries =
    entry.kind === "file"
      ? [
          entry,
          ...queueEntries(inventory, session).filter(
            (candidate) =>
              candidate.kind !== "file" &&
              candidate.sites.A.length > 0 &&
              candidate.sites.A.every((site) => entry.sites.A.some((file) => file.path === site.path))
          ),
        ]
      : [entry];
  for (const current of entries)
    session.reviews[current.id] = {
      status: state,
      fingerprint: fingerprint(current),
      sites: structuredClone(current.sites),
    };
}

/** Candidate evidence is extracted from selected files, never a hand-maintained migration map. */
export function replacementCandidates(
  entry: Entry,
  inventory: Inventory
): { relative: string; shared: string[] }[] {
  const keys = (text: string) =>
    new Set(
      parseScript(text)
        .root.statements.filter((s) => s.kind === "assignment" && s.value?.kind === "block")
        .map((s) => (s.kind === "assignment" ? s.key.text : ""))
    );
  const old = keys(entry.sites.base[0]?.text ?? "");
  return [...inventory.files.B]
    .filter(([relative]) => relative !== entry.name && path.extname(relative) === path.extname(entry.name))
    .map(([relative, text]) => ({ relative, shared: [...keys(text)].filter((key) => old.has(key)) }))
    .filter(
      (candidate) =>
        candidate.shared.length || path.basename(candidate.relative) === path.basename(entry.name)
    )
    .sort((a, b) => b.shared.length - a.shared.length || a.relative.localeCompare(b.relative));
}
export function hasConflictMarkers(text: string): boolean {
  return /^(?:<{7}|\|{7}|={7}|>{7})(?:\s|$)/m.test(text);
}
