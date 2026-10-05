import * as vscode from "vscode";

export function experimentalFeaturesEnabled(): boolean {
  return vscode.workspace.getConfiguration("px").get<boolean>("experimentalFeatures", false);
}

export function requireExperimentalFeatures(): void {
  if (!experimentalFeaturesEnabled())
    throw new Error("Enable Experimental features in Toolkit Settings to use Compatch.");
}
