/**
 * Firing-order arrangement of one event's blocks: the whole "what happens when
 * this fires" reading, derived from `paradox/eventDetail` alone. The server
 * owns event structure (rendered lines, step-into targets); this only decides
 * ORDER and the honest wording for the blocks that are absent or empty.
 *
 * IMPORTANT: this function ships twice. It is unit-tested here as a normal
 * import, and its *source* is serialized (`simulationSteps.toString()`) into
 * the webview script by panel.ts so the tested code is the shipped code. It
 * must therefore stay self-contained:
 *   - reference nothing outside its own parameters and locally declared names,
 *   - no imports/closures/module globals,
 *   - plain ES2020 that survives `.toString()`.
 *
 * The type annotations here are erased by tsc before the body is emitted.
 */
import type { EventDetail, EventScriptLine, EventStepTarget } from "@px-lsp/protocol/protocol";

export interface SimStep {
  kind: "trigger" | "cancellation_trigger" | "on_trigger_fail" | "immediate" | "option" | "after" | "other";
  /** Heading, e.g. "TRIGGER" or "OPTION A". */
  title: string;
  /** Second heading line: an option's resolved text, else "". */
  subtitle: string;
  /** 0-based source line the heading jumps to. */
  line: number;
  /** Shown instead of the script when the block contributes nothing. */
  note: string;
  lines: EventScriptLine[];
  /** Lines the server capped away; 0 when nothing is hidden. */
  hidden: number;
  targets: EventStepTarget[];
  /** Targets the server capped away; 0 when nothing is hidden. */
  hiddenTargets: number;
}

/**
 * The blocks of `detail` in the order the game runs them: the gating trigger
 * (always shown, so "this event has no trigger" is stated rather than left to
 * inference), the two branches that belong to it (cancellation_trigger,
 * on_trigger_fail — one game each), immediate, every option, then after.
 * Sections the event does not have are omitted; sections it has but left empty
 * say so.
 */
export function simulationSteps(detail: EventDetail): SimStep[] {
  const steps: SimStep[] = [];
  const sectionNamed = (name: string) =>
    detail.sections.filter((s) => s.name.toLowerCase() === name)[0] ?? null;

  const pushSection = (name: string, kind: SimStep["kind"], title: string, absent: string | null): void => {
    const section = sectionNamed(name);
    if (!section) {
      if (absent !== null)
        steps.push({
          kind,
          title,
          subtitle: "",
          line: detail.line,
          note: absent,
          lines: [],
          hidden: 0,
          targets: [],
          hiddenTargets: 0,
        });
      return;
    }
    steps.push({
      kind,
      title,
      subtitle: "",
      line: section.line,
      note: section.totalLines === 0 ? "(empty block)" : "",
      lines: section.lines,
      hidden: Math.max(0, section.totalLines - section.lines.length),
      targets: section.targets,
      hiddenTargets: Math.max(0, section.targetsTotal - section.targets.length),
    });
  };

  pushSection("trigger", "trigger", "TRIGGER", "(no trigger: fires whenever it is called)");
  // Vic3 only: re-checked while the event waits, and cancels it if it passes.
  pushSection("cancellation_trigger", "cancellation_trigger", "CANCELLATION TRIGGER", null);
  pushSection("on_trigger_fail", "on_trigger_fail", "ON TRIGGER FAIL", null);
  pushSection("immediate", "immediate", "IMMEDIATE", null);

  for (let i = 0; i < detail.options.length; i++) {
    const opt = detail.options[i];
    const label = i < 26 ? String.fromCharCode(65 + i) : "#" + (i + 1);
    let subtitle: string;
    if (opt.name && opt.name.dynamic) subtitle = "(dynamic name, resolved in game)";
    else if (opt.name && opt.name.text) subtitle = opt.name.text;
    else if (opt.name && opt.name.key) subtitle = opt.name.key + " (no localization)";
    else subtitle = "(unnamed option)";
    steps.push({
      kind: "option",
      title: "OPTION " + label,
      subtitle,
      line: opt.line,
      note: opt.totalLines === 0 ? "(no effects: the option only closes the event)" : "",
      lines: opt.lines,
      hidden: Math.max(0, opt.totalLines - opt.lines.length),
      targets: opt.targets,
      hiddenTargets: Math.max(0, opt.targetsTotal - opt.targets.length),
    });
  }

  pushSection("after", "after", "AFTER", null);

  // Any section the server reports that this ordering does not name, so a new
  // one shows up instead of vanishing.
  const named = ["trigger", "cancellation_trigger", "on_trigger_fail", "immediate", "after"];
  for (const section of detail.sections) {
    if (named.indexOf(section.name.toLowerCase()) >= 0) continue;
    steps.push({
      kind: "other",
      title: section.name.toUpperCase(),
      subtitle: "",
      line: section.line,
      note: section.totalLines === 0 ? "(empty block)" : "",
      lines: section.lines,
      hidden: Math.max(0, section.totalLines - section.lines.length),
      targets: section.targets,
      hiddenTargets: Math.max(0, section.targetsTotal - section.targets.length),
    });
  }

  return steps;
}
