/**
 * Heap ceiling for the forked language server. No `vscode` imports.
 *
 * The definition index is the server's dominant allocation and it is large by
 * design. Measured (budgets.test.ts, post-GC retained): ~408 MB for a full
 * vanilla scan of ~463k definitions, i.e. ~924 B each. Peak during the scan is
 * roughly 1.5x that before the collector catches up, and every extra root —
 * workspace mods, and the `parentPaths` submod chain — adds its whole
 * definition set on top.
 *
 * Node derives its default old-space size from system RAM, which lands around
 * 2 GB on an 8 GB machine — inside crash range for a total conversion plus a
 * framework parent. So raise the floor to 4 GB, but never claim more than half
 * of physical RAM, so a small machine is not pushed into swap. On a 16 GB+ box
 * this matches what Node would have chosen anyway.
 */
const MIN_MB = 2048;
const TARGET_MB = 4096;

export function serverHeapMb(totalBytes: number): number {
  const halfRam = Math.floor(totalBytes / 1024 / 1024 / 2);
  return Math.max(MIN_MB, Math.min(TARGET_MB, halfRam));
}
