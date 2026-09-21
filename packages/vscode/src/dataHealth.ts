import type { StatusPayload } from "@px-lsp/protocol/protocol";

/** Shared wording for Setup and the status tooltip, based on loaded data. */
export function dataHealthLines(status: StatusPayload, dataTypesCommand: string): [string, string, string] {
  const ownDocs = status.tokensFromScriptDocs && !status.tokensFromBundledDumps;
  const scriptSource =
    status.tokens === 0
      ? "no usable data loaded"
      : ownDocs
        ? "your generated dump (wiki usage examples may supplement it)"
        : "toolkit-provided set (bundled data)";
  const typeSource =
    status.dataTypesSource === "generated"
      ? "your generated dump (bundled entries may supplement it)"
      : status.dataTypesSource === "bundled"
        ? "toolkit-provided set (bundled data)"
        : status.dataTypesSource === "none"
          ? "no usable data loaded"
          : "source not reported by this server";
  return [
    `script_docs: ${scriptSource}`,
    `data types / datafunctions: ${typeSource}`,
    `${ownDocs && status.dataTypesSource === "generated" ? "Refresh" : "Recommended: generate"} both dumps after each game patch: script_docs and ${dataTypesCommand}. Then run Paradox: Reload Game Data.`,
  ];
}

/** Readiness comes from loaded data and resolved configuration, never command invocation. */
export function onboardingReadiness(
  status: StatusPayload & {
    gameOk: boolean;
    modOk: boolean;
    tigerOk: boolean;
    tigerName: string | null;
  }
): Record<"px.setupReady" | "px.modReady" | "px.dumpsReady" | "px.tigerReady", boolean> {
  return {
    "px.setupReady": !status.indexing && status.gameOk && status.modOk && status.tokens > 0,
    "px.modReady": status.modOk && !status.indexing,
    "px.dumpsReady":
      status.tokens > 0 &&
      status.tokensFromScriptDocs &&
      !status.tokensFromBundledDumps &&
      status.dataTypesSource === "generated",
    "px.tigerReady": status.tigerName !== null && status.tigerOk,
  };
}
