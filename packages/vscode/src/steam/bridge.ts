/**
 * Steam Workshop bridge: a standalone child process around the native
 * @jdeffner/steamwand binding (koffi FFI), kept OUT of the extension host so
 * a native crash or a hung Steam client can never take the extension down.
 * Spawned by workshop.ts or the Workshop panel via ELECTRON_RUN_AS_NODE with
 * argv[2] = path to the copied steamwand package (dist/steamwand).
 *
 * stdin/stdout contract and job/event types: steam/jobs.ts.
 *
 * Talking to the Steam client through ISteamUGC needs no credentials: the
 * user's running, logged-in Steam session is the authorization. While the
 * bridge runs, Steam shows the user as in-game (the API initializes under the
 * game's app id) - unavoidable and harmless, it ends with the process.
 *
 * Per-language updates (SetItemUpdateLanguage) are part of steamwand's
 * generated binding: the symbol either resolves at load or throws. The old
 * languageProbe capability gate is gone with the steamworks.js backend that
 * needed it.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { Steam, WorkshopItem } from "@jdeffner/steamwand";
import {
  type BridgeDone,
  type BridgeEvent,
  type BridgeJob,
  type ItemDetails,
  type SubmitSpec,
  type WorkshopVisibility,
} from "./jobs";

type Steamwand = typeof import("@jdeffner/steamwand");

/** ISteamUGC EItemUpdateStatus, as user-facing phrases. */
const UPDATE_STATUS: Record<number, string> = {
  0: "Waiting for Steam",
  1: "Preparing configuration",
  2: "Preparing content",
  3: "Uploading content",
  4: "Uploading preview image",
  5: "Committing changes",
};

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

function toDetails(item: WorkshopItem): ItemDetails {
  const stat = (key: keyof WorkshopItem["statistics"]): number | null => {
    const v = item.statistics[key];
    return v === undefined ? null : Number(v);
  };
  return {
    itemId: item.fileId.toString(),
    title: item.title,
    description: item.description,
    visibility: item.visibility as WorkshopVisibility,
    tags: item.tags,
    previewUrl: item.previewUrl,
    timeCreated: item.timeCreated,
    timeUpdated: item.timeUpdated,
    banned: item.banned,
    numUpvotes: item.votesUp,
    numDownvotes: item.votesDown,
    numSubscriptions: stat("numSubscriptions"),
    numFavorites: stat("numFavorites"),
    numUniqueWebsiteViews: stat("numUniqueWebsiteViews"),
    numComments: stat("numComments"),
  };
}

function submitOnce(
  steam: Steam,
  appId: number,
  itemId: bigint,
  spec: SubmitSpec,
  position: { submit: number; submits: number }
): Promise<{ needsToAcceptAgreement: boolean }> {
  return steam.workshop
    .submitUpdate(
      itemId,
      {
        title: spec.title,
        description: spec.description,
        changeNote: spec.changeNote,
        contentPath: spec.contentPath,
        previewPath: spec.previewPath,
        tags: spec.tags,
        visibility: spec.visibility,
        language: spec.language,
      },
      {
        appId,
        onProgress: (p) => {
          emit({
            type: "progress",
            status: UPDATE_STATUS[p.status] ?? `Status ${p.status}`,
            uploaded: Number(p.bytesProcessed),
            total: Number(p.bytesTotal),
            ...position,
          });
        },
        progressIntervalMs: 500,
      }
    )
    .then((r) => ({ needsToAcceptAgreement: r.legalAgreementRequired }));
}

async function main(): Promise<void> {
  const steamwandDir = process.argv[2];
  if (!steamwandDir) fail("missing steamwand module path argument");
  const job = JSON.parse(await readStdin()) as BridgeJob;

  if (job.action === "publish") {
    // steamwand checks these too; checking here keeps the error message next
    // to the job instead of mid-upload, and covers older builds.
    for (const s of job.submits) {
      if (s.contentPath && !existsSync(s.contentPath))
        fail(`content folder does not exist: ${s.contentPath}`);
      if (s.previewPath && !existsSync(s.previewPath)) fail(`preview image does not exist: ${s.previewPath}`);
    }
    if (job.submits.length === 0) fail("publish job carries no submits");
  }

  let sw: Steamwand;
  try {
    sw = createRequire(__filename)(steamwandDir) as Steamwand;
  } catch (e) {
    fail(`cannot load the Steamwand module: ${errText(e)}`);
  }

  let steam: Steam;
  try {
    steam = sw.init({ appId: job.appId });
  } catch (e) {
    // Valve's own diagnostic text; workshop.ts prepends the likely causes.
    fail(`Steam init failed: ${errText(e)}`);
  }

  switch (job.action) {
    case "create": {
      try {
        const created = await steam.workshop.createItem(job.appId);
        done({
          action: "create",
          itemId: created.fileId.toString(),
          needsToAcceptAgreement: created.legalAgreementRequired,
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
          const r = await submitOnce(steam, job.appId, itemId, job.submits[i], {
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
        const item = await steam.workshop.getItem(BigInt(job.itemId), { longDescription: true });
        const translations: Record<string, { title: string; description: string }> = {};
        for (const language of job.languages ?? []) {
          const t = await steam.workshop.getItem(BigInt(job.itemId), {
            language,
            longDescription: true,
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
        const page = await steam.workshop.getUserItems(1, steam.accountId(), { appId: job.appId });
        done({
          action: "list",
          items: page.items.map((it) => ({
            itemId: it.fileId.toString(),
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
