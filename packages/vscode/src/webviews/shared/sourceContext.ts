/** Source coordinates in native webview menus are zero-based, like VS Code positions. */
export interface SourceContext {
  webviewSection: "px.graphNode" | "px.guiWidget" | "px.coaDefinition" | "px.definition";
  pxSourceFile?: string;
  pxSourceLine?: number;
  pxDefinitionId?: string;
  pxDefinitionKind?: string;
}

export function setSourceContext(element: Element, context: SourceContext | null): void {
  if (context) element.setAttribute("data-vscode-context", JSON.stringify(context));
  else element.removeAttribute("data-vscode-context");
}

/** Keep the native menu path for both pointer and keyboard invocation. */
export function sourceContextKeys(event: KeyboardEvent, element: Element): boolean {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return false;
  event.preventDefault();
  event.stopPropagation();
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(24, rect.width / 2),
      clientY: rect.top + Math.min(24, rect.height / 2),
      button: 2,
    })
  );
  return true;
}
