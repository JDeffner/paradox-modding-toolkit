export type SettingsTarget = "user" | "workspace" | `folder:${string}`;
export type SettingValue = string | boolean | number | null | string[] | Record<string, unknown>;

export interface SettingSchema {
  type: string | string[];
  default: SettingValue;
  scope?: string;
  enum?: string[];
  enumDescriptions?: string[];
  markdownDescription?: string;
  description?: string;
  pattern?: string;
  patternErrorMessage?: string;
}

export interface SettingRow {
  key: string;
  label: string;
  group: string;
  schema: SettingSchema;
  value: SettingValue;
  explicit: boolean;
  stamp: string;
  source: string;
  override?: string;
  disabled?: string;
  browse?: "folder" | "file";
  resolved?: string;
  pathStatus?: string;
  names?: string;
}

export interface SettingsState {
  target: SettingsTarget;
  targets: { id: SettingsTarget; label: string }[];
  rows: SettingRow[];
  game: string;
  summary: string[];
  actions: { command: string; label: string; group: string }[];
}

export type AppToHost =
  | { type: "ready"; target?: SettingsTarget }
  | { type: "target"; target: SettingsTarget }
  | { type: "refresh" }
  | {
      type: "save";
      id: number;
      target: SettingsTarget;
      key: string;
      stamp: string;
      value: SettingValue;
      reset?: boolean;
    }
  | { type: "browse"; id: number; target: SettingsTarget; key: string }
  | { type: "action"; command: string };

export type HostToApp =
  | { type: "reveal"; key: string }
  | { type: "state"; state: SettingsState }
  | { type: "result"; id: number; error?: string; value?: string }
  | { type: "error"; message: string };
