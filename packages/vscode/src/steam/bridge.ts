/**
 * Steam Workshop bridge: a standalone child process around the native
 * steamworks.js module, kept OUT of the extension host so a native crash or a
 * hung Steam client can never take the extension down. Spawned by workshop.ts
 * via ELECTRON_RUN_AS_NODE with argv[2] = path to the copied steamworks.js
 * package (dist/steamworks).
 *
 * stdin:  one JSON job (see BridgeJob).
 * stdout: newline-delimited JSON events: created | progress | done | error.
 *
 * Talking to the Steam client through ISteamUGC needs no credentials: the
 * user's running, logged-in Steam session is the authorization. While the
 * bridge runs, Steam shows the user as in-game (the API initializes under the
 * game's app id) - unavoidable and harmless, it ends with the process.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

interface BridgeJob {
  appId: number;
  action: "create" | "update";
  /** Workshop item id (decimal string; JSON has no bigint). Update only. */
  itemId?: string;
  update?: {
    title?: string;
    description?: string;
    changeNote?: string;
    previewPath?: string;
    contentPath: string;
    tags?: string[];
  };
}

/** The slice of steamworks.js the bridge uses (full types: its client.d.ts). */
interface SteamworksModule {
  init(appId: number): {
    workshop: {
      createItem(appId?: number): Promise<{ itemId: bigint; needsToAcceptAgreement: boolean }>;
      updateItemWithCallback(
        itemId: bigint,
        updateDetails: BridgeJob["update"],
        appId: number,
        successCallback: (data: { itemId: bigint; needsToAcceptAgreement: boolean }) => void,
        errorCallback: (err: unknown) => void,
        progressCallback?: (data: { status: number; progress: bigint; total: bigint }) => void,
        progressCallbackIntervalMs?: number
      ): void;
    };
  };
}

/** ISteamUGC EItemUpdateStatus, as user-facing phrases. */
const UPDATE_STATUS: Record<number, string> = {
  0: "Waiting for Steam",
  1: "Preparing configuration",
  2: "Preparing content",
  3: "Uploading content",
  4: "Uploading preview image",
  5: "Committing changes",
};

function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function fail(message: string): never {
  emit({ type: "error", message });
  process.exit(1);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const steamworksDir = process.argv[2];
  if (!steamworksDir) fail("missing steamworks module path argument");
  const job = JSON.parse(await readStdin()) as BridgeJob;

  let sw: SteamworksModule;
  try {
    sw = createRequire(__filename)(steamworksDir) as SteamworksModule;
  } catch (e) {
    fail(`cannot load the Steamworks module: ${e instanceof Error ? e.message : String(e)}`);
  }

  let client: ReturnType<SteamworksModule["init"]>;
  try {
    client = sw.init(job.appId);
  } catch (e) {
    // The native init error is cryptic; workshop.ts prepends the likely causes.
    fail(`Steam init failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (job.action === "create") {
    try {
      const created = await client.workshop.createItem(job.appId);
      emit({
        type: "done",
        itemId: created.itemId.toString(),
        needsToAcceptAgreement: created.needsToAcceptAgreement,
      });
      process.exit(0);
    } catch (e) {
      fail(`creating the Workshop item failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!job.itemId || !job.update) fail("update job needs itemId and update details");
  // The native layer PANICS (kills the process) on a missing path instead of
  // reporting through the error callback - verified against steamworks.js
  // 0.4.0. Check here so a bad path stays a readable error.
  if (!existsSync(job.update.contentPath)) fail(`content folder does not exist: ${job.update.contentPath}`);
  if (job.update.previewPath && !existsSync(job.update.previewPath)) {
    fail(`preview image does not exist: ${job.update.previewPath}`);
  }
  client.workshop.updateItemWithCallback(
    BigInt(job.itemId),
    job.update,
    job.appId,
    (data) => {
      emit({
        type: "done",
        itemId: data.itemId.toString(),
        needsToAcceptAgreement: data.needsToAcceptAgreement,
      });
      process.exit(0);
    },
    (err) => fail(`upload failed: ${err instanceof Error ? err.message : String(err)}`),
    (data) => {
      emit({
        type: "progress",
        status: UPDATE_STATUS[data.status] ?? `Status ${data.status}`,
        uploaded: Number(data.progress),
        total: Number(data.total),
      });
    },
    500
  );
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
