/**
 * The message pair every visual creator needs and none of them should spell
 * twice: a webview asking the host to turn game asset paths into pictures.
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
}
