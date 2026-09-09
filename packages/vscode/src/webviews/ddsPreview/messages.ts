import type { ViewerBackground } from "../shared/viewerBackground";

export type AppToHost =
  | { type: "ready" | "copyPath" | "copyName" | "reveal" | "savePng" }
  | { type: "background"; value: ViewerBackground };

export type HostToApp = { type: "background"; value: ViewerBackground };
