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
