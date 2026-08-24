/**
 * The event graph's layout is its force simulation (force.ts) run to rest,
 * with the x axis owned by sequence ranks. This module is the headless face
 * of it: the names the view and the tests import, so a layout in a test is
 * exactly the shape the canvas settles into.
 */
export {
  forceLayout as flowLayout,
  rankNodes,
  COL_W,
  GAP,
  NODE_H,
  NODE_W,
  type SimEdgeInput as LayoutEdgeInput,
  type SimNodeInput as LayoutNodeInput,
  type SimPos as LayoutPos,
} from "./force";
