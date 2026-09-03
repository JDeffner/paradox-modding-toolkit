/**
 * The messages every visual creator needs and none of them should spell twice:
 * turning game asset paths into pictures, copying a block of script, and
 * saying where the next save lands.
 *
 * The app never sees a .dds. It names the paths the game itself names
 * (`gfx/interface/icons/traits/brave.dds`, read out of a schema entry's icon
 * folder or a definition's own `icon =`), and the host answers with URLs its
 * decoder produced (`creators/images.ts`). A key the host could not resolve
 * comes back as `null`, which a creator SHOWS as "no picture" instead of
 * drawing a broken image.
 *
 * Plain types, no vscode and no DOM: both sides of the wire import this.
 */

/** App -> host. `maxDim` caps the decode's longest edge (a thumbnail asks small). */
export interface CreatorImagesRequest {
  type: "images";
  /** Game-relative asset paths, forward slashes, no `..` and never absolute. */
  keys: string[];
  maxDim?: number;
}

/** Host -> app: one entry per requested key, `null` when nothing resolved. */
export interface CreatorImagesReply {
  type: "images";
  urls: Record<string, string | null>;
  /** The request's own cap, echoed: a thumbnail and a full-size decode of one path are two pictures. */
  maxDim?: number;
}

/**
 * App -> host: put this text on the clipboard. A webview cannot reach the
 * clipboard, so the host writes it and answers with the toast.
 */
export interface CreatorCopyRequest {
  type: "copy";
  text: string;
}

/**
 * Where a creator's next save goes, for the top bar to SHOW (saveTarget.ts).
 * The path is mod-relative with forward slashes (`common/traits/mymod.txt`):
 * an absolute machine path is the host's business, not the modder's.
 */
export interface CreatorSaveTarget {
  /** The mod's own name, as its descriptor gives it. */
  modLabel: string;
  path: string;
}

/** Host -> app: the target the next save will use, resolved without asking. */
export interface CreatorTargetReply {
  type: "target";
  target: CreatorSaveTarget | null;
}

/** App -> host: the modder clicked the line; open the picker. */
export interface CreatorChangeTargetRequest {
  type: "changeTarget";
}
