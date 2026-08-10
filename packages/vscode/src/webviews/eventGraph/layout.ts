/**
 * Pure, dependency-free layered graph layout (Sugiyama-lite).
 *
 * IMPORTANT: this function ships twice. It is unit-tested here as a normal
 * import, and its *source* is serialized (`layoutGraph.toString()`) into the
 * webview script by panel.ts so the tested code is the shipped code. It must
 * therefore stay self-contained:
 *   - reference nothing outside its own parameters and locally declared names,
 *   - no imports/closures/module globals,
 *   - plain ES2020 that survives `.toString()`.
 *
 * The type annotations here are erased by tsc before the body is emitted, so
 * `.toString()` yields plain JS (verify: no `: Type` or `as` survives runtime).
 */

export interface LayoutNodeInput {
  id: string;
}
export interface LayoutEdgeInput {
  from: string;
  to: string;
}
export interface LayoutPos {
  x: number;
  y: number;
}

/**
 * Assign a position to every node. Layering is by BFS distance from the
 * root(s) (edge direction = increasing layer / increasing x). Within a layer,
 * nodes are ordered by the barycenter of their already-placed neighbours to
 * reduce edge crossings. Fully deterministic; cycles are guarded by a visited
 * set; disconnected nodes are laid out in their own trailing layers.
 */
export function layoutGraph(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  rootId?: string
): Map<string, LayoutPos> {
  const LAYER_GAP = 220;
  const NODE_GAP = 90;
  const has = (obj: Record<string, unknown>, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, key);

  const ids: string[] = [];
  const idSet: Record<string, boolean> = {};
  for (let i = 0; i < nodes.length; i++) {
    const nid = nodes[i].id;
    if (has(idSet, nid)) continue;
    idSet[nid] = true;
    ids.push(nid);
  }

  const out: Record<string, string[]> = {};
  const incoming: Record<string, string[]> = {};
  for (let a = 0; a < ids.length; a++) {
    out[ids[a]] = [];
    incoming[ids[a]] = [];
  }
  for (let e = 0; e < edges.length; e++) {
    const f = edges[e].from;
    const t = edges[e].to;
    if (!has(idSet, f)) continue;
    if (!has(idSet, t)) continue;
    if (f === t) continue;
    out[f].push(t);
    incoming[t].push(f);
  }

  // Deterministic BFS seed order: explicit root, then declared roots (no
  // incoming edges), then any remaining nodes in declared order.
  const seeds: string[] = [];
  const seeded: Record<string, boolean> = {};
  const addSeed = (id: string): void => {
    if (has(seeded, id)) return;
    seeded[id] = true;
    seeds.push(id);
  };
  if (rootId != null && has(idSet, rootId)) addSeed(rootId);
  for (let r = 0; r < ids.length; r++) {
    if (incoming[ids[r]].length === 0) addSeed(ids[r]);
  }
  for (let s = 0; s < ids.length; s++) addSeed(ids[s]);

  // BFS layering with a visited guard (cycle-safe).
  const layer: Record<string, number> = {};
  const visited: Record<string, boolean> = {};
  const queue: string[] = [];
  let head = 0;
  for (let q = 0; q < seeds.length; q++) {
    const seed = seeds[q];
    if (has(visited, seed)) continue;
    visited[seed] = true;
    layer[seed] = 0;
    queue.push(seed);
    while (head < queue.length) {
      const cur = queue[head++];
      const neigh = out[cur];
      for (let nn = 0; nn < neigh.length; nn++) {
        const nb = neigh[nn];
        const cand = layer[cur] + 1;
        // Cap at node count: a simple path can't be longer, so a cycle's
        // back-edge stops re-deepening here instead of looping forever.
        if (!has(visited, nb)) {
          visited[nb] = true;
          layer[nb] = cand;
          queue.push(nb);
        } else if (cand > layer[nb] && cand <= ids.length) {
          // Push descendant deeper so edges always point to a higher layer.
          layer[nb] = cand;
          queue.push(nb);
        }
      }
    }
  }
  for (let d = 0; d < ids.length; d++) {
    if (!has(layer, ids[d])) layer[ids[d]] = 0;
  }

  // Bucket nodes per layer, preserving declared order as the stable tiebreak.
  let maxLayer = 0;
  for (let m = 0; m < ids.length; m++) {
    if (layer[ids[m]] > maxLayer) maxLayer = layer[ids[m]];
  }
  const layers: string[][] = [];
  for (let L = 0; L <= maxLayer; L++) layers.push([]);
  const order: Record<string, number> = {};
  for (let o = 0; o < ids.length; o++) {
    const oid = ids[o];
    order[oid] = layers[layer[oid]].length;
    layers[layer[oid]].push(oid);
  }

  // Barycenter ordering sweeps to reduce crossings (deterministic, fixed count).
  const baryPass = (useIncoming: boolean): void => {
    for (let li = 0; li < layers.length; li++) {
      const lyr = layers[li];
      const scored: { id: string; bary: number; tie: number }[] = [];
      for (let k = 0; k < lyr.length; k++) {
        const nodeId = lyr[k];
        const refs = useIncoming ? incoming[nodeId] : out[nodeId];
        let sum = 0;
        let cnt = 0;
        for (let rr = 0; rr < refs.length; rr++) {
          const other = refs[rr];
          if (has(order, other)) {
            sum += order[other];
            cnt++;
          }
        }
        const bary = cnt > 0 ? sum / cnt : order[nodeId];
        scored.push({ id: nodeId, bary: bary, tie: k });
      }
      scored.sort((p, w) => {
        if (p.bary !== w.bary) return p.bary - w.bary;
        return p.tie - w.tie;
      });
      const newLyr: string[] = [];
      for (let z = 0; z < scored.length; z++) {
        newLyr.push(scored[z].id);
        order[scored[z].id] = z;
      }
      layers[li] = newLyr;
    }
  };
  for (let pass = 0; pass < 4; pass++) {
    baryPass(true);
    baryPass(false);
  }

  // Assign coordinates: layer -> x, position-in-layer -> y (centred).
  const pos = new Map<string, LayoutPos>();
  for (let lx = 0; lx < layers.length; lx++) {
    const col = layers[lx];
    const totalH = (col.length - 1) * NODE_GAP;
    for (let c = 0; c < col.length; c++) {
      let x = lx * LAYER_GAP;
      let y = c * NODE_GAP - totalH / 2;
      if (!isFinite(x)) x = 0;
      if (!isFinite(y)) y = 0;
      pos.set(col[c], { x: x, y: y });
    }
  }
  return pos;
}
