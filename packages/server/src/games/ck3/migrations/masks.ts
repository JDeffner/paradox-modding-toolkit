import type { MigrationQuestion } from "@px-lsp/protocol/migration";
import {
  MIGRATION_LIMITS,
  type MigrationAnswers,
  type MigrationByteRequest,
  type MigrationContext,
  type MigrationFinding,
  type MigrationGroup,
  type MigrationInspection,
  type MigrationProposal,
  type MigrationRecipe,
  type MigrationRoot,
} from "../../../migrations/sdk";
import { walkStatements, type AssignmentNode, type Statement } from "../../../parser/cst";
import {
  adjustDdsMipLevels,
  inspectDdsHeader,
  inspectDdsResource,
  type DdsResourceHeader,
} from "../../../dds/migrateMips";

export const maskBatchKey = "ck3-mask:batch";
export function maskPolicyKey(path: string): string {
  return `ck3-mask:${path.toLowerCase()}:policy`;
}
export function maskKeepNoteKey(path: string): string {
  return `ck3-mask:${path.toLowerCase()}:keep-note`;
}

const COVERAGE = [
  "Consumers are entity/game_data/portrait_entity_user_data/portrait_accessory/pattern_mask in .asset files and pattern_textures/colormask in gfx/portraits/accessory_variations/*.txt. Texture names do not determine applicability.",
  "Exact target counterparts provide counts only when their consumer, format, resource kind and dimensions match. Custom textures require an explicit per-file policy. A chain ending at 256 is an author choice, not a universal engine rule.",
  "Only selected mod DDS payloads are loaded. Other affected textures keep this entry pending until later batches are processed. Captured dependencies outside the mod and target roots are not evaluated.",
  "Target consumer findings cover mod textures and definitions or files overridden by the mod. Unrelated target anomalies are outside this migration; malformed and unsupported mod consumers still block it. This is not a full asset integrity scan.",
  "Retained mod levels are preserved byte for byte. Source and target headers do not establish pixel equality. Upstream target pixel changes are not rebased into the mod texture.",
  "Target-game rendering is not run. Preview stored levels and inspect each affected accessory on a character in the complete target game, then check fresh graphics logs.",
];

function fields(statements: Statement[]): AssignmentNode[] {
  return statements.filter((node): node is AssignmentNode => node.kind === "assignment");
}
function children(node: AssignmentNode): AssignmentNode[] {
  return node.value?.kind === "block" ? fields(node.value.statements) : [];
}
function scalar(node: AssignmentNode | undefined): string | undefined {
  return node?.value?.kind === "scalar" ? node.value.text : undefined;
}
function textPath(path: string): boolean {
  return (
    /\.asset$/iu.test(path) ||
    (path.toLowerCase().startsWith("gfx/portraits/accessory_variations/") && /\.txt$/iu.test(path))
  );
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function finding(id: string, message: string, path?: string): MigrationFinding {
  return { id, severity: "error", message, ...(path ? { path } : {}) };
}

interface Consumer {
  key: string;
  path: string;
  textures: string[];
  references: string[];
}
interface Inventory {
  candidates: string[];
  matchingConsumers: Set<string>;
  names: Record<MigrationRoot, Map<string, string>>;
  findings: MigrationFinding[];
}

/** Consumer shapes measured in the 1.20.0.2 vanilla asset and variation databases. */
async function inventory(context: MigrationContext): Promise<Inventory> {
  // Profiles register this recipe before the parser's active profile exists.
  const [{ parseScript }, { validateMigrationPath }] = await Promise.all([
    import("../../../parser/parser"),
    import("../../../migrations/engine"),
  ]);
  const names = {
    mod: new Map<string, string>(),
    source: new Map<string, string>(),
    target: new Map<string, string>(),
  };
  for (const root of ["mod", "source", "target"] as const) {
    for (const path of context.list(root, "gfx")) names[root].set(path.toLowerCase(), path);
  }
  const findings: MigrationFinding[] = [];
  const consumers: Record<"mod" | "target", Consumer[]> = { mod: [], target: [] };
  const targetIssues: { finding: MigrationFinding; path: string; keys: string[]; references: string[] }[] =
    [];
  // This is a relevance hint only, never a valid input path. Invalid aliases that
  // name a mod texture must still block that texture, including leading /gfx paths.
  const referenceHint = (value: string) =>
    value
      .replaceAll("\\", "/")
      .toLowerCase()
      .replace(/^(?:[a-z]:)?\/+/, "")
      .replace(/^(?:\.\.?\/)+/, "");
  const modTextures = new Set([...names.mod.keys()].filter((path) => /\.dds$/iu.test(path)));
  const report = (
    root: "mod" | "target",
    item: MigrationFinding,
    path: string,
    keys: string[],
    references: string[]
  ) => {
    if (root === "mod") findings.push(item);
    else targetIssues.push({ finding: item, path, keys, references });
  };
  for (const root of ["mod", "target"] as const) {
    for (const path of [...names[root].values()].filter(textPath).sort()) {
      const text = context.readText(root, path);
      if (text === undefined) {
        findings.push(
          finding(`mask.text:${root}:${path}`, `Consumer input was not captured: ${root}/${path}`, path)
        );
        continue;
      }
      const parsed = parseScript(text);
      const used = new Set<AssignmentNode>();
      const fileKeys: string[] = [],
        fileReferences: string[] = [];
      for (const definition of fields(parsed.root.statements)) {
        const textureFields: AssignmentNode[] = [];
        let kind: string | undefined;
        if (/\.asset$/iu.test(path) && definition.key.text === "entity") {
          kind = "entity";
          for (const gameData of children(definition).filter((node) => node.key.text === "game_data")) {
            for (const userData of children(gameData).filter(
              (node) => node.key.text === "portrait_entity_user_data"
            )) {
              for (const accessory of children(userData).filter(
                (node) => node.key.text === "portrait_accessory"
              )) {
                textureFields.push(...children(accessory).filter((node) => node.key.text === "pattern_mask"));
              }
            }
          }
        } else if (!/\.asset$/iu.test(path) && definition.key.text === "pattern_textures") {
          kind = "pattern_textures";
          textureFields.push(...children(definition).filter((node) => node.key.text === "colormask"));
        }
        if (!kind) continue;
        const name = scalar(children(definition).find((node) => node.key.text === "name"));
        const keys = name ? [`${kind}:${name}`] : [];
        const references = textureFields.flatMap((node) => {
          const value = scalar(node);
          return value ? [referenceHint(value)] : [];
        });
        fileKeys.push(...keys);
        fileReferences.push(...references);
        if (!name && textureFields.length) {
          report(
            root,
            finding(
              `mask.name:${root}:${path}:${definition.range.start}`,
              "Mask consumer has no scalar name; its override identity cannot be established.",
              path
            ),
            path,
            keys,
            references
          );
        }
        const textures: string[] = [];
        for (const node of textureFields) {
          used.add(node);
          try {
            const value = scalar(node);
            if (!value) throw new Error("Mask reference must be a nonempty scalar DDS path.");
            const texture = validateMigrationPath(value.replaceAll("\\", "/"));
            if (!texture.toLowerCase().startsWith("gfx/") || !/\.dds$/iu.test(texture)) {
              throw new Error("Mask reference must name a DDS file below gfx/.");
            }
            textures.push(texture.toLowerCase());
          } catch (error) {
            report(
              root,
              finding(`mask.reference:${root}:${path}:${node.range.start}`, errorText(error), path),
              path,
              keys,
              references
            );
          }
        }
        if (name) consumers[root].push({ key: `${kind}:${name}`, path, textures, references });
      }
      walkStatements(parsed.root, (node) => {
        if (
          node.kind === "assignment" &&
          ["pattern_mask", "colormask"].includes(node.key.text) &&
          !used.has(node)
        ) {
          const references = scalar(node) ? [referenceHint(scalar(node)!)] : [];
          fileReferences.push(...references);
          report(
            root,
            finding(
              `mask.consumer:${path}:${node.range.start}`,
              `Unsupported ${node.key.text} consumer shape; establish its contract before migrating its texture.`,
              path
            ),
            path,
            fileKeys,
            references
          );
        }
      });
      if (parsed.errors.length) {
        report(
          root,
          finding(
            `mask.syntax:${root}:${path}`,
            `Cannot establish mask consumers from malformed script: ${parsed.errors[0].message}`,
            path
          ),
          path,
          fileKeys,
          fileReferences
        );
      }
    }
  }
  const modKeys = new Set(consumers.mod.map((consumer) => consumer.key));
  const relevantTargetKeys = new Set(
    consumers.target
      .filter(
        (consumer) =>
          modKeys.has(consumer.key) ||
          names.mod.has(consumer.path.toLowerCase()) ||
          consumer.references.some((reference) => modTextures.has(reference))
      )
      .map((consumer) => consumer.key)
  );
  for (const issue of targetIssues)
    if (
      names.mod.has(issue.path.toLowerCase()) ||
      issue.keys.some((key) => relevantTargetKeys.has(key)) ||
      issue.references.some((reference) => modTextures.has(reference))
    )
      findings.push(issue.finding);
  const targetContracts = new Set(
    consumers.target.flatMap((consumer) =>
      consumer.textures.map((texture) => `${consumer.key.split(":")[0]}:${texture}`)
    )
  );
  const effective = new Map<string, Consumer>();
  for (const root of ["target", "mod"] as const) {
    const inRoot = new Map<string, Consumer>();
    for (const consumer of consumers[root]) {
      if (root === "target" && names.mod.has(consumer.path.toLowerCase())) continue;
      const previous = inRoot.get(consumer.key);
      if (
        previous &&
        JSON.stringify(previous.textures) !== JSON.stringify(consumer.textures) &&
        (root === "mod" || relevantTargetKeys.has(consumer.key))
      ) {
        findings.push(
          finding(
            `mask.duplicate:${root}:${consumer.key}`,
            `Conflicting definitions of ${consumer.key} in ${previous.path} and ${consumer.path}.`,
            consumer.path
          )
        );
      }
      inRoot.set(consumer.key, consumer);
      effective.set(consumer.key, consumer);
    }
  }
  const candidateKeys = new Set<string>();
  const matchingConsumers = new Set<string>();
  const mismatchingConsumers = new Set<string>();
  for (const consumer of effective.values()) {
    for (const texture of consumer.textures) {
      if (names.mod.has(texture)) {
        candidateKeys.add(texture);
        if (targetContracts.has(`${consumer.key.split(":")[0]}:${texture}`)) matchingConsumers.add(texture);
        else mismatchingConsumers.add(texture);
      } else if (
        !names.target.has(texture) &&
        (modKeys.has(consumer.key) ||
          names.mod.has(consumer.path.toLowerCase()) ||
          relevantTargetKeys.has(consumer.key))
      ) {
        findings.push(
          finding(
            `mask.missing:${texture}`,
            `Mask consumer ${consumer.key} refers to missing texture ${texture}; provide the mod or target asset.`,
            consumer.path
          )
        );
      }
    }
  }
  for (const texture of mismatchingConsumers) matchingConsumers.delete(texture);
  return {
    candidates: [...candidateKeys].map((key) => names.mod.get(key)!).sort(),
    matchingConsumers,
    names,
    findings,
  };
}

interface Candidate {
  path: string;
  count: number;
  size: number;
  outputSize: number;
}
interface Survey {
  findings: MigrationFinding[];
  questions: MigrationQuestion[];
  affected: Candidate[];
  candidates: number;
  selection: Candidate[];
}

function stopAt256(header: DdsResourceHeader): number | undefined {
  const { width, height } = header;
  if (width !== height || width < 256 || !Number.isInteger(Math.log2(width))) return undefined;
  return Math.log2(width / 256) + 1;
}

async function survey(context: MigrationContext, answers: Readonly<MigrationAnswers>): Promise<Survey> {
  const inputs = await inventory(context);
  const findings = [...inputs.findings];
  const questions: MigrationQuestion[] = [];
  const affected: Candidate[] = [];
  for (const path of inputs.candidates) {
    try {
      const bytes = context.readBytes("mod", path);
      if (!bytes) throw new Error("DDS header was not captured.");
      const header = inspectDdsHeader(bytes);
      if (header.resourceKind !== "2d")
        throw new Error(
          `Unsupported ${header.resourceKind} DDS resource; only simple 2D masks are supported.`
        );
      const size = context.fileInfo("mod", path)?.size;
      if (size === undefined) throw new Error("DDS input size was not captured.");
      if (header.expectedByteLength === undefined)
        throw new Error(`Unsupported DDS format or resource layout: ${header.format}.`);
      if (size !== header.expectedByteLength)
        throw new Error("DDS file size does not match its declared mip payload boundaries.");
      if (size > MIGRATION_LIMITS.fileBytes)
        throw new Error(`DDS exceeds the per-file migration limit of ${MIGRATION_LIMITS.fileBytes} bytes.`);
      const targetPath = inputs.names.target.get(path.toLowerCase());
      const targetBytes = targetPath && context.readBytes("target", targetPath);
      let count: number | undefined;
      if (targetBytes && inputs.matchingConsumers.has(path.toLowerCase())) {
        const target = inspectDdsHeader(targetBytes);
        if (
          target.expectedByteLength === undefined ||
          context.fileInfo("target", targetPath!)?.size !== target.expectedByteLength
        )
          throw new Error(`Target DDS has unsupported or malformed payload boundaries: ${targetPath}`);
        if (
          target.width === header.width &&
          target.height === header.height &&
          target.format === header.format &&
          target.resourceKind === header.resourceKind
        ) {
          count = target.mipLevelCount;
          findings.push({
            id: `mask.evidence:${path}`,
            severity: "info",
            path,
            message: `Exact target consumer and DDS ${targetPath}: ${header.width}x${header.height}, ${header.format}, ${header.mipLevelCount} stored levels; target requires ${count}.`,
          });
        }
      }
      const key = maskPolicyKey(path);
      if (count === undefined) {
        const options = [
          { value: "keep", label: `Keep the current ${header.mipLevelCount} levels (requires a reason)` },
        ];
        const stopCount = stopAt256(header);
        if (stopCount !== undefined)
          options.push({
            value: "stop-at-256",
            label: `End at 256x256 (${stopCount} levels), chosen by the author`,
          });
        for (let n = 1; n <= header.fullMipLevelCount; n++)
          options.push({ value: `count:${n}`, label: `${n} stored level${n === 1 ? "" : "s"}` });
        questions.push({
          id: key,
          group: path,
          label: `Mip policy: ${path}`,
          description:
            "No exact target consumer and matching DDS contract establishes the count. Choose a policy for this texture and verify it in the target game.",
          kind: "choice",
          required: true,
          options,
        });
        const policy = answers[key];
        if (policy === "keep") {
          questions.push({
            id: maskKeepNoteKey(path),
            group: path,
            label: `Reason for keeping ${path}`,
            kind: "text",
            required: true,
          });
          const note = answers[maskKeepNoteKey(path)];
          if (typeof note !== "string" || !note.trim()) {
            findings.push(
              finding(
                `mask.keep-note:${path}`,
                "Keeping a custom mask requires a nonempty author reason.",
                path
              )
            );
          } else
            findings.push({
              id: `mask.kept:${path}`,
              severity: "warning",
              path,
              message: `Author keeps ${header.mipLevelCount} levels: ${note.trim()}. Target rendering still needs verification.`,
            });
          continue;
        }
        if (policy === "stop-at-256") count = stopCount;
        else if (typeof policy === "string" && /^count:[1-9]\d*$/u.test(policy))
          count = Number(policy.slice(6));
        if (policy !== undefined && (count === undefined || count < 1 || count > header.fullMipLevelCount)) {
          findings.push(
            finding(
              `mask.policy:${path}`,
              "The selected mip policy is not valid for this DDS resource.",
              path
            )
          );
        }
      } else if (answers[key] !== undefined) {
        findings.push(
          finding(
            `mask.policy-conflict:${path}`,
            "An old custom policy conflicts with newly available exact target evidence. Clear the custom answer and review the target count.",
            path
          )
        );
      }
      if (count !== undefined && count !== header.mipLevelCount) {
        const proposedHeader = bytes.slice(0, header.dataOffset);
        new DataView(proposedHeader.buffer).setUint32(28, count, true);
        const outputSize = inspectDdsHeader(proposedHeader).expectedByteLength!;
        if (outputSize > MIGRATION_LIMITS.fileBytes)
          throw new Error("Requested mip generation exceeds the per-file output size limit.");
        affected.push({ path, count, size, outputSize });
      }
    } catch (error) {
      findings.push(finding(`mask.dds:${path}`, errorText(error), path));
    }
  }

  // Prefixes and consumer text remain in every snapshot, including later batches.
  let fixedBytes = 0;
  for (const root of ["mod", "source", "target"] as const) {
    for (const path of context.list(root, "gfx")) fixedBytes += context.readBytes(root, path)?.length ?? 0;
  }
  // A selected full payload replaces its prefix. Remove full payload inflation on prepare.
  for (const item of affected)
    fixedBytes -= Math.max(0, (context.readBytes("mod", item.path)?.length ?? 0) - Math.min(148, item.size));
  const budget = MIGRATION_LIMITS.inputBytes - fixedBytes;
  const batches = new Map<string, Candidate[]>();
  const cost = (items: Candidate[]) =>
    items.reduce((sum, item) => sum + Math.max(item.size - Math.min(148, item.size), item.outputSize), 0);
  if (affected.length && cost(affected) <= budget) batches.set("all", affected);
  const folders = new Map<string, Candidate[]>();
  for (const item of affected) {
    const folder = item.path.slice(0, item.path.lastIndexOf("/"));
    folders.set(folder, [...(folders.get(folder) ?? []), item]);
  }
  for (const [folder, items] of folders) {
    let part: Candidate[] = [],
      index = 1;
    for (const item of items) {
      if (cost([item]) > budget) {
        findings.push(
          finding(
            `mask.batch-size:${item.path}`,
            "This texture does not fit alongside the captured consumer inputs. Reduce the migration scope or input size.",
            item.path
          )
        );
        continue;
      }
      if (part.length && cost([...part, item]) > budget) {
        batches.set(`folder:${folder}:${index++}`, part);
        part = [];
      }
      part.push(item);
      batches.set(`texture:${item.path}`, [item]);
    }
    if (part.length) batches.set(`folder:${folder}:${index}`, part);
  }
  if (affected.length) {
    questions.push({
      id: maskBatchKey,
      label: "Texture batch",
      description: `${affected.length} textures need mip changes. Choose a batch before its complete binary inputs are loaded. Process later batches until no affected textures remain.`,
      kind: "choice",
      required: true,
      options: [...batches].map(([value, items]) => ({
        value,
        label: `${value === "all" ? "All affected textures" : value.replace(/^(?:folder|texture):/u, "")} (${items.length} textures, ${Math.ceil(cost(items) / 1024 / 1024)} MiB)`,
      })),
    });
  }
  const selection =
    typeof answers[maskBatchKey] === "string" ? (batches.get(answers[maskBatchKey] as string) ?? []) : [];
  return { findings, questions, affected, candidates: inputs.candidates.length, selection };
}

async function inspect(
  context: MigrationContext,
  answers: Readonly<MigrationAnswers>
): Promise<MigrationInspection> {
  const result = await survey(context, answers);
  const pendingPolicies = result.questions.some(
    (question) => question.id !== maskBatchKey && answers[question.id] === undefined
  );
  return {
    applicability: result.findings.some((item) => item.severity === "error")
      ? "unknown"
      : result.affected.length || pendingPolicies
        ? "applicable"
        : "not-applicable",
    findings: result.findings,
    questions: result.questions,
    coverage: [
      ...COVERAGE,
      `Traced ${result.candidates} mod textures through effective consumers; ${result.affected.length} require mip changes under the current evidence and answers.`,
    ],
  };
}

async function prepare(
  context: MigrationContext,
  answers: Readonly<MigrationAnswers>
): Promise<MigrationProposal> {
  const result = await survey(context, answers);
  const unresolved = result.findings.filter((item) => item.severity === "error");
  const groups: MigrationGroup[] = [];
  for (const item of result.selection) {
    try {
      const bytes = context.readBytes("mod", item.path);
      if (!bytes || bytes.length !== item.size)
        throw new Error("Selected DDS payload has not been captured in full. Refresh the batch preview.");
      const before = inspectDdsResource(bytes);
      const output = adjustDdsMipLevels(bytes, item.count);
      const after = inspectDdsResource(output);
      if (
        after.width !== before.width ||
        after.height !== before.height ||
        after.format !== before.format ||
        after.resourceKind !== before.resourceKind ||
        after.mipLevelCount !== item.count
      )
        throw new Error("DDS output changed the texture contract or has the wrong count.");
      const retained = before.levels[Math.min(before.mipLevelCount, after.mipLevelCount) - 1];
      const end = retained.offset + retained.byteLength;
      if (
        !bytes
          .subarray(before.dataOffset, end)
          .every((byte, index) => byte === output[after.dataOffset + index])
      )
        throw new Error("DDS output changed retained mod pixels.");
      groups.push({
        id: `mask:${item.path}`,
        title: `${item.path}: ${before.mipLevelCount} to ${item.count} stored levels`,
        dependsOn: [],
        changes: [{ kind: "replace", path: item.path, bytes: output }],
      });
    } catch (error) {
      unresolved.push(finding(`mask.output:${item.path}`, errorText(error), item.path));
    }
  }
  return {
    groups,
    unresolved,
    continuation: result.selection.length < result.affected.length,
    checks: [
      {
        id: "mask.structure",
        label: "DDS resource boundaries, requested counts and retained mod levels",
        stage: "before-apply",
        necessity: "required",
        status: unresolved.length ? "failed" : "passed",
        detail: `${groups.length} selected texture outputs checked. Source and target inputs remain read-only.`,
      },
      {
        id: "mask.render",
        label: "Inspect affected accessories and stored levels in the target game",
        stage: "after-apply",
        necessity: "advisory",
        status: "not-run",
        detail: "Valid DDS structure does not establish correct target-game rendering.",
      },
    ],
  };
}

export const ck3PortraitMaskMigration = {
  manifest: {
    id: "ck3.portrait-mask-mips",
    revision: "1",
    sdkVersion: 2,
    gameId: "ck3",
    fromVersion: "1.19.0.6",
    toVersion: "1.20.0.2",
    kind: "recipe",
    detection: "script",
    requirement: "required",
    title: "Migrate portrait and clothing mask mip levels",
    description:
      "Trace effective portrait consumers, use exact target texture evidence, and prepare pixel-preserving DDS mip changes in bounded batches.",
    guidance:
      "Resolve custom texture policies, select a batch, review its DDS replacements, and continue until every affected texture is handled. Verify the actual accessories in the target game.",
    limitations: COVERAGE,
    dependsOn: [],
    evidence: [
      "gfx/models/**/*.asset: entity/game_data/portrait_entity_user_data/portrait_accessory/pattern_mask",
      "gfx/portraits/accessory_variations/*.txt: pattern_textures/colormask",
      "Exact target DDS resource headers in the selected 1.20.0.2 reference",
    ],
    inputs: [
      ...(["mod", "target"] as const).flatMap((root) => [
        { root, path: "gfx", extensions: [".asset"] },
        { root, path: "gfx/portraits/accessory_variations", extensions: [".txt"] },
      ]),
      // Target consumers can reference unchanged textures outside the mod's bounded header capture.
      { root: "target", path: "gfx", extensions: [".dds"], capture: "listing" },
      ...(["mod", "source", "target"] as const).map((root) => ({
        root,
        path: "gfx",
        extensions: [".dds"],
        capture: "prefix" as const,
        prefixBytes: 148,
        ...(root === "mod" ? {} : { matchModFiles: true }),
      })),
    ],
  },
  async discover(context, answers): Promise<MigrationByteRequest[]> {
    if (answers[maskBatchKey] === undefined) return [];
    return (await survey(context, answers)).selection.map((item) => ({ root: "mod", path: item.path }));
  },
  inspect,
  prepare,
} satisfies MigrationRecipe;

/** Current consumer and same-path DDS evidence source-checked on 1.20.0.3. */
export const ck3PortraitMaskMigration12003 = {
  ...ck3PortraitMaskMigration,
  manifest: {
    ...ck3PortraitMaskMigration.manifest,
    id: "ck3.portrait-mask-mips.1.20.0.3",
    toVersion: "1.20.0.3",
    evidence: [
      "gfx/models/**/*.asset: entity/game_data/portrait_entity_user_data/portrait_accessory/pattern_mask",
      "gfx/portraits/accessory_variations/*.txt: pattern_textures/colormask",
      "Exact target DDS resource headers in the selected 1.20.0.3 reference",
    ],
  },
} satisfies MigrationRecipe;
