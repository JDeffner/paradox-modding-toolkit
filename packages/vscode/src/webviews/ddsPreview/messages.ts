import type { ViewerBackground } from "../shared/viewerBackground";

export type AppToHost =
  | { type: "ready" | "copyPath" | "copyName" | "reveal" | "savePng" }
  | { type: "mip"; level: number }
  | { type: "background"; value: ViewerBackground };

export type HostToApp =
  | { type: "background"; value: ViewerBackground }
  | { type: "mip"; level: number; dataUri: string; meta: string }
  | { type: "mipError"; level: number; message: string };
