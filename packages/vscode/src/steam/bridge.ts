/**
 * Steam Workshop bridge: a standalone child process around the native
 * steamworks.js module, kept OUT of the extension host so a native crash or a
 * hung Steam client can never take the extension down. Spawned by workshop.ts
 * or the Workshop panel via ELECTRON_RUN_AS_NODE with argv[2] = path to the
 * copied steamworks.js package (dist/steamworks).
 *
 * stdin/stdout contract and job/event types: steam/jobs.ts.
 *
 * Talking to the Steam client through ISteamUGC needs no credentials: the
 * user's running, logged-in Steam session is the authorization. While the
 * bridge runs, Steam shows the user as in-game (the API initializes under the
 * game's app id) - unavoidable and harmless, it ends with the process.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  LANGUAGE_UPDATE_MIN_VERSION,
  versionAtLeast,
  type BridgeDone,
  type BridgeEvent,
  type BridgeJob,
  type ItemDetails,
  type SubmitSpec,
  type WorkshopVisibility,
} from "./jobs";

/** What steamworks.js getItem returns, the slice the bridge reads (client.d.ts WorkshopItem). */
interface NativeItem {
  publishedFileId: bigint;
  title: string;
  description: string;
  visibility: number;
  tags: string[];
  previewUrl?: string;
  timeCreated: number;
  timeUpdated: number;
  banned: boolean;
  numUpvotes: number;
  numDownvotes: number;
  statistics: Record<string, bigint | undefined>;
}

/** The slice of steamworks.js the bridge uses (full types: its client.d.ts). */
interface SteamworksModule {
  init(appId: number): {
    localplayer: { getSteamId(): { accountId: number } };
    workshop: {
      createItem(appId?: number): Promise<{ itemId: bigint; needsToAcceptAgreement: boolean }>;
      updateItemWithCallback(
        itemId: bigint,
        updateDetails: SubmitSpec,
        appId: number,
        successCallback: (data: { itemId: bigint; needsToAcceptAgreement: boolean }) => void,
        errorCallback: (err: unknown) => void,
        progressCallback?: (data: { status: number; progress: bigint; total: bigint }) => void,
        progressCallbackIntervalMs?: number
      ): void;
      getItem(
        item: bigint,
        queryConfig?: { language?: string; includeLongDescription?: boolean }
      ): Promise<NativeItem | null>;
      getUserItems(
        page: number,
        accountId: number,
        listType: number,
        itemType: number,
        sortOrder: number,
        appIds: { creator?: number; consumer?: number },
        queryConfig?: { includeLongDescription?: boolean }
      ): Promise<{ items: (NativeItem | null | undefined)[]; totalResults: number }>;
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

// getUserItems enum values (client.d.ts): UserListType.Published,
// UGCType.Items, UserListOrder.LastUpdatedDesc.
const LIST_PUBLISHED = 0;
const TYPE_ITEMS = 0;
const ORDER_LAST_UPDATED = 3;

function emit(event: BridgeEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function fail(message: string): never {
  emit({ type: "error", message });
  process.exit(1);
}

function done(result: BridgeDone): never {
  emit({ type: "done", result });
  process.exit(0);
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function toDetails(item: NativeItem): ItemDetails {
  const stat = (key: string): number | null => {
    const v = item.statistics?.[key];
    return v === undefined ? null : Number(v);
  };
  return {
    itemId: item.publishedFileId.toString(),
    title: item.title,
    description: item.description,
    visibility: item.visibility as WorkshopVisibility,
    tags: item.tags ?? [],
    previewUrl: item.previewUrl ?? null,
    timeCreated: item.timeCreated,
    timeUpdated: item.timeUpdated,
    banned: item.banned,
    numUpvotes: item.numUpvotes,
    numDownvotes: item.numDownvotes,
    numSubscriptions: stat("numSubscriptions"),
    numFavorites: stat("numFavorites"),
    numUniqueWebsiteViews: stat("numUniqueWebsiteViews"),
    numComments: stat("numComments"),
  };
}

function submitOnce(
  client: ReturnType<SteamworksModule["init"]>,
  appId: number,
  itemId: bigint,
  spec: SubmitSpec,
  position: { submit: number; submits: number }
): Promise<{ needsToAcceptAgreement: boolean }> {
  return new Promise((resolve, reject) => {
    client.workshop.updateItemWithCallback(
      itemId,
      spec,
      appId,
      (data) => resolve({ needsToAcceptAgreement: data.needsToAcceptAgreement }),
      (err) => reject(new Error(errText(err))),
      (data) => {
        emit({
          type: "progress",
          status: UPDATE_STATUS[data.status] ?? `Status ${data.status}`,
          uploaded: Number(data.progress),
          total: Number(data.total),
          ...position,
        });
      },
      500
    );
  });
}

async function main(): Promise<void> {
  const steamworksDir = process.argv[2];
  if (!steamworksDir) fail("missing steamworks module path argument");
  const job = JSON.parse(await readStdin()) as BridgeJob;

  if (job.action === "publish") {
    // The gate must hold BEFORE anything uploads: an older native layer drops
    // the unknown `language` field, and the translation would overwrite the
    // default-language title and description instead.
    if (job.submits.some((s) => s.language)) {
      let version = "0.0.0";
      try {
        version = (
          JSON.parse(readFileSync(join(steamworksDir, "package.json"), "utf8")) as { version: string }
        ).version;
      } catch {
        /* unreadable = too old */
      }
      if (!versionAtLeast(version, LANGUAGE_UPDATE_MIN_VERSION)) {
        fail(
          `translation uploads need steamworks.js ${LANGUAGE_UPDATE_MIN_VERSION} or newer ` +
            `(bundled: ${version}); this build would overwrite the default-language text instead`
        );
      }
    }
    // The native layer PANICS (kills the process) on a missing path instead of
    // reporting through the error callback - verified against steamworks.js
    // 0.4.0. Check here so a bad path stays a readable error.
    for (const s of job.submits) {
      if (s.contentPath && !existsSync(s.contentPath))
        fail(`content folder does not exist: ${s.contentPath}`);
      if (s.previewPath && !existsSync(s.previewPath)) fail(`preview image does not exist: ${s.previewPath}`);
    }
    if (job.submits.length === 0) fail("publish job carries no submits");
  }

  let sw: SteamworksModule;
  try {
    sw = createRequire(__filename)(steamworksDir) as SteamworksModule;
  } catch (e) {
    fail(`cannot load the Steamworks module: ${errText(e)}`);
  }

  let client: ReturnType<SteamworksModule["init"]>;
  try {
    client = sw.init(job.appId);
  } catch (e) {
    // The native init error is cryptic; workshop.ts prepends the likely causes.
    fail(`Steam init failed: ${errText(e)}`);
  }

  switch (job.action) {
    case "create": {
      try {
        const created = await client.workshop.createItem(job.appId);
        done({
          action: "create",
          itemId: created.itemId.toString(),
          needsToAcceptAgreement: created.needsToAcceptAgreement,
        });
      } catch (e) {
        fail(`creating the Workshop item failed: ${errText(e)}`);
      }
      break;
    }
    case "publish": {
      const itemId = BigInt(job.itemId);
      let needsAgreement = false;
      for (let i = 0; i < job.submits.length; i++) {
        try {
          const r = await submitOnce(client, job.appId, itemId, job.submits[i], {
            submit: i + 1,
            submits: job.submits.length,
          });
          needsAgreement = needsAgreement || r.needsToAcceptAgreement;
        } catch (e) {
          const lang = job.submits[i].language;
          fail(`${lang ? `uploading the ${lang} translation` : "upload"} failed: ${errText(e)}`);
        }
      }
      done({ action: "publish", itemId: job.itemId, needsToAcceptAgreement: needsAgreement });
      break;
    }
    case "query": {
      try {
        const item = await client.workshop.getItem(BigInt(job.itemId), { includeLongDescription: true });
        const translations: Record<string, { title: string; description: string }> = {};
        for (const language of job.languages ?? []) {
          const t = await client.workshop.getItem(BigInt(job.itemId), {
            language,
            includeLongDescription: true,
          });
          if (t) translations[language] = { title: t.title, description: t.description };
        }
        done({ action: "query", item: item ? toDetails(item) : null, translations });
      } catch (e) {
        fail(`reading the Workshop item failed: ${errText(e)}`);
      }
      break;
    }
    case "list": {
      try {
        const accountId = client.localplayer.getSteamId().accountId;
        const page = await client.workshop.getUserItems(
          1,
          accountId,
          LIST_PUBLISHED,
          TYPE_ITEMS,
          ORDER_LAST_UPDATED,
          { creator: job.appId, consumer: job.appId }
        );
        done({
          action: "list",
          items: (page.items ?? [])
            .filter((it): it is NativeItem => !!it)
            .map((it) => ({
              itemId: it.publishedFileId.toString(),
              title: it.title,
              timeUpdated: it.timeUpdated,
            })),
          total: page.totalResults,
        });
      } catch (e) {
        fail(`listing your Workshop items failed: ${errText(e)}`);
      }
      break;
    }
    default:
      fail(`unknown action: ${(job as { action?: string }).action ?? "?"}`);
  }
}

void main().catch((e: unknown) => fail(errText(e)));
