import * as vscode from "vscode";

export interface StartupNotice {
  message: string;
  label?: string;
  command?: string;
  run?: () => void | PromiseLike<unknown>;
  /** Existing once-only notice key, kept compatible with prior releases. */
  key?: string;
  scope?: "global" | "workspace";
  /** Configuration failures still appear when optional notices are disabled. */
  essential?: boolean;
}

/** Collect activation advice before showing a single decision. All details remain in Output. */
export class StartupNotices {
  private readonly pending: StartupNotice[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: (message: string) => void
  ) {}

  add(notice: StartupNotice): void {
    this.log(notice.message);
    const state = notice.scope === "workspace" ? this.context.workspaceState : this.context.globalState;
    if (notice.key && state.get<boolean>(notice.key)) return;
    if (
      !notice.essential &&
      !vscode.workspace.getConfiguration("px").get<boolean>("notifications.startup", true)
    )
      return;
    this.pending.push(notice);
  }

  async show(): Promise<void> {
    const notices = this.pending.splice(0);
    if (!notices.length) return;
    for (const notice of notices) {
      if (!notice.key) continue;
      const state = notice.scope === "workspace" ? this.context.workspaceState : this.context.globalState;
      await state.update(notice.key, true);
    }
    const summary =
      notices.length === 1
        ? notices[0]!.message
        : `Paradox Modding Toolkit: ${notices.length} setup notices. Review the details or run Setup & Health Check.`;
    const choices = ["Setup & Health Check", "Review Notices", "Don't Show Optional Notices"];
    const choice = notices.some((notice) => notice.essential)
      ? await vscode.window.showWarningMessage(summary, ...choices)
      : await vscode.window.showInformationMessage(summary, ...choices);
    if (choice === "Setup & Health Check") {
      await vscode.commands.executeCommand("px.setup");
    } else if (choice === "Don't Show Optional Notices") {
      await vscode.workspace
        .getConfiguration("px")
        .update("notifications.startup", false, vscode.ConfigurationTarget.Global);
    } else if (choice === "Review Notices") {
      const picked = await vscode.window.showQuickPick(
        notices.map((notice) => ({
          label: notice.label ?? "Setup & Health Check",
          detail: notice.message,
          notice,
        })),
        {
          title: "Paradox: Setup Notices",
          placeHolder: "Choose a next step",
          matchOnDetail: true,
        }
      );
      if (!picked) return;
      if (picked.notice.run) await picked.notice.run();
      else await vscode.commands.executeCommand(picked.notice.command ?? "px.setup");
    }
  }
}
