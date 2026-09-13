/** One display preference shared by texture editors and hover thumbnails. */
export type TexturePreviewBackground = "checkerboard" | "dark" | "light" | `#${string}`;

export const TEXTURE_CHECKER_SIZE = 8;

export function readTexturePreviewBackground(value: unknown): TexturePreviewBackground {
  if (value === "dark" || value === "light") return value;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value))
    return value.toLowerCase() as TexturePreviewBackground;
  return "checkerboard";
}

/** Equal colors make a solid background; different colors make the checkerboard. */
export function texturePreviewColors(background: TexturePreviewBackground): readonly [string, string] {
  if (background === "checkerboard") return ["#c0c0c0", "#808080"];
  const color = background === "dark" ? "#181818" : background === "light" ? "#f2f2f2" : background;
  return [color, color];
}
