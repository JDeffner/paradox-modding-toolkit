/**
 * The Credits panel (px.openCredits): every upstream project the toolkit
 * builds on, with what it is used for, its license and a link to its home.
 *
 * The page is static markup, so this host has no message contract and no app
 * bundle: it creates the panel, renders once and gets out of the way. The
 * links are plain https hrefs, which a webview opens in the browser itself.
 */
import * as vscode from "vscode";
import { creditsHtml } from "./html";
import { tabIcon } from "../tabIcons";

export class CreditsPanel {
  private static instance: CreditsPanel | undefined;
  private static readonly viewType = "px.credits";

  private readonly panel: vscode.WebviewPanel;

  private constructor() {
    this.panel = vscode.window.createWebviewPanel(
      CreditsPanel.viewType,
      "Credits",
      vscode.ViewColumn.Active,
      {
        enableScripts: false,
        retainContextWhenHidden: true,
      }
    );
    this.panel.iconPath = tabIcon("credits");
    this.panel.webview.html = creditsHtml({
      csp: [`default-src 'none'`, `style-src 'unsafe-inline'`].join("; "),
    });
    this.panel.onDidDispose(() => {
      CreditsPanel.instance = undefined;
    });
  }

  static show(): void {
    const existing = CreditsPanel.instance;
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    CreditsPanel.instance = new CreditsPanel();
  }
}
