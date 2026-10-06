import type { WikiLocation, WikiReadingState } from "./messages";

const HISTORY_LIMIT = 50;
const POSITION_LIMIT = 200;
export const positionKey = (location: WikiLocation): string => JSON.stringify([location.game, location.page]);

export function initialWikiState(game: string): WikiReadingState {
  return {
    version: 1,
    current: { page: null, game, query: "" },
    back: [],
    forward: [],
    positions: {},
    diagOpen: false,
  };
}

/** Workspace storage and webview messages are both external state boundaries. */
export function parseWikiState(value: unknown): WikiReadingState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Partial<WikiReadingState>;
  const location = (v: unknown): v is WikiLocation => {
    if (!v || typeof v !== "object") return false;
    const l = v as WikiLocation;
    return (
      (l.page === null || (typeof l.page === "string" && l.page.length <= 200)) &&
      typeof l.game === "string" &&
      l.game.length <= 30 &&
      typeof l.query === "string" &&
      l.query.length <= 2000
    );
  };
  if (
    state.version !== 1 ||
    !location(state.current) ||
    typeof state.diagOpen !== "boolean" ||
    !Array.isArray(state.back) ||
    state.back.length > HISTORY_LIMIT ||
    !state.back.every(location) ||
    !Array.isArray(state.forward) ||
    state.forward.length > HISTORY_LIMIT ||
    !state.forward.every(location) ||
    !state.positions ||
    typeof state.positions !== "object" ||
    Array.isArray(state.positions)
  )
    return undefined;
  const positions = Object.entries(state.positions);
  if (
    positions.length > POSITION_LIMIT ||
    positions.some(
      ([key, p]) =>
        key.length > 300 ||
        !p ||
        typeof p !== "object" ||
        !Number.isFinite(p.scroll) ||
        p.scroll < 0 ||
        !(p.cardKind === null || (typeof p.cardKind === "string" && p.cardKind.length <= 200))
    )
  )
    return undefined;
  return structuredClone(state as WikiReadingState);
}

export function rememberPosition(state: WikiReadingState, scroll: number, cardKind: string | null): void {
  const key = positionKey(state.current);
  delete state.positions[key];
  state.positions[key] = { scroll, cardKind };
  const keys = Object.keys(state.positions);
  if (keys.length > POSITION_LIMIT) delete state.positions[keys[0]];
}

export function visit(state: WikiReadingState, next: WikiLocation): void {
  if (
    state.current.page === next.page &&
    state.current.game === next.game &&
    state.current.query === next.query
  )
    return;
  state.back.push({ ...state.current });
  state.back = state.back.slice(-HISTORY_LIMIT);
  state.forward = [];
  state.current = next;
}

export function travel(state: WikiReadingState, direction: "back" | "forward"): boolean {
  const source = state[direction];
  const next = source.pop();
  if (!next) return false;
  const destination = direction === "back" ? "forward" : "back";
  state[destination].push({ ...state.current });
  state[destination] = state[destination].slice(-HISTORY_LIMIT);
  state.current = next;
  return true;
}
