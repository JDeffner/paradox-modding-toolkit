/**
 * Save-file preview values: the curated chain -> text mapping, read off a
 * synthetic save written by the test (a plain Victoria 3 one and a zip-packed
 * Crusader Kings III one), the zip locator, the refusals (ironman, binary),
 * and one case per game gated on a real save.
 *
 * Run the gated cases (Git Bash):
 *   PX_VIC3_SAVE='<path to a non-ironman .v3 save>' \
 *   PX_CK3_SAVE='<path to a non-ironman .ck3 save>' npx vitest run test/saveValues.test.ts
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import { IRONMAN_ERROR, readSaveValues } from "../src/gui/saveValues";
import { findZipEntry } from "../src/gui/saveZip";
import { CK3_SAVE_SCHEMA } from "../src/games/ck3/saveSchema";
import { VIC3_SAVE_SCHEMA } from "../src/games/vic3/saveSchema";

/** The loc index a Vic3 workspace would answer with. */
const LOC: Record<string, string> = {
  GBR: "Great Britain",
  GER: "Germany",
  GBR_ADJ: "British",
  great_power: "Great Power",
  STATE_HOME_COUNTIES: "Home Counties",
  // CK3 keeps a character's first name as a loc key.
  Alp_Arslan: "Alp Arslan",
};
const loc = (key: string) => LOC[key];

/**
 * A save in miniature: the same shape a Victoria 3 save writes, including the
 * two traps that matter — a header line before the script, and indentation that
 * resets inside `database` (so only brace depth says where a block ends).
 */
const SAVE = `SAV01001dab18be0000048d
meta_data={
	save_game_version=1786392871
	version="1.13.10"
	game_date=1836.1.21
	name="Great Britain"
	rank=great_power
	flag={
		sub={
			parent="sub_GBR_uk"
			pattern="pattern_gironny_8.dds"
		}
	}
	mods={ "PRH Probe" }
	ironman=no
}
playthrough_id="b43090b2-819c-4f2b-aedc-8a53a7c6da0c"
date=1836.1.21
country_manager={
	database={
0={
	is_main_tag=yes
	definition="GER"
	ruler=4294967295
	capital=4294967295
	budget={
		money=0
	}
}
1={
	is_main_tag=yes
	definition="GBR"
	ruler=3854
	heir=3855
	capital=5
	budget={
		weekly_income={ 0 0 0 }
		money=1247181.89015
	}
	states={ 5 6 114 }
}
	}
}
states={
	database={
0={
	country=3
	region="STATE_SVEALAND"
}
5={
	capital=18791
	country=1
	traded_goods={ tea fabric silk }
	region="STATE_HOME_COUNTIES"
}
	}
}
character_manager={
	database={
0={
	first_name="Francis"
	last_name="Welby-Gregory"
}
3854={
	first_name="William"
	last_name="Hannover"
	dna="AAAA{}"
	traits={ romantic }
}
3855={
	first_name="Victoria"
	last_name="Hannover"
}
	}
}
player_manager={
}
`;

/**
 * A CK3 gamestate in miniature, with the three traps that matter: `meta_data`
 * opens it (the copy before the archive is not what the reader uses), the
 * played character is named at the very END (long after the `living` record),
 * and a quoted `dna` carries braces.
 */
const CK3_META = `meta_data={
	save_game_version=15
	version="1.19.0.6"
	meta_date=1066.10.28
	meta_player_name="Sultan al-Muazzam Alp Arslan"
	meta_title_name="the Seljuk Empire"
	meta_house_name="Seljuk"
	meta_main_portrait={
		type=male
		id=32188
	}
	ironman=no
}`;

const CK3_GAMESTATE = `${CK3_META}
variables={
	data={ {
			flag=seljuk_invasion_happened
			data={
				type=boolean
				identity=1
			}
		}
 }
}
living={
32187={
	first_name="Tughril"
	birth=1000.1.1
}
32188={
	first_name="Alp_Arslan"
	birth=1029.1.1
	dna="AAAA{}"
	dynasty_house=10570
	alive_data={
		variables={
			data={ {
					flag=cultivation_realm
					data={
						type=value
						identity=300000
					}
				}
 {
					flag=chancellor_opinion_value
					data={
						type=value
						identity=25000
					}
				}
 {
					flag=crowned_emperor_var
					data={
						type=boolean
						identity=1
					}
				}
 {
					flag=my_vizier
					data={
						type=char
						identity=30263
					}
				}
 {
					flag=spiritual_root_awakened
					data={
					}
				}
 }
		}
		gold={
			value=1813.97322
		}
		piety={
			currency=552.4375
			accumulated=1002.4375
		}
		prestige={
			currency=708.1726
		}
	}
	landed_data={
		domain={ 5990 5991 }
	}
}
}
played_character={
	name="Lonely Sora"
	character=32188
	player=1
}
currently_played_characters={ 32188 }
`;

const CK3_HEADER = `SAV01022428995100007dea\n${CK3_META}\n`;

/** One stored-or-deflated local file header, the only zip structure CK3 needs. */
function zipEntry(name: string, body: Buffer, raw: number, opts: { streamed?: boolean } = {}): Buffer {
  const nameBytes = Buffer.from(name, "latin1");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(opts.streamed ? 0x08 : 0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(opts.streamed ? 0 : body.length, 18);
  header.writeUInt32LE(opts.streamed ? 0 : raw, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes, body]);
}

/** The real file shape: header line, plain-text `meta_data`, then the archive. */
function ck3Save(gamestate: string): Buffer {
  const text = Buffer.from(gamestate, "utf8");
  return Buffer.concat([
    Buffer.from(CK3_HEADER, "utf8"),
    zipEntry("gamestate", zlib.deflateRawSync(text), text.length),
  ]);
}

let dir: string | undefined;
function saveBytes(name: string, bytes: Buffer): string {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "px-save-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

function saveFile(name: string, text: string): string {
  return saveBytes(name, Buffer.from(text, "utf8"));
}

describe("readSaveValues", () => {
  it("maps the curated chains to values read off the save", async () => {
    const file = saveFile("vic3.v3", SAVE);
    const { values, source, error } = await readSaveValues(file, {
      gameId: "vic3",
      schema: VIC3_SAVE_SCHEMA,
      loc,
    });

    expect(error).toBeUndefined();
    expect(source).toEqual({ name: "Great Britain", date: "21 January 1836", game: "vic3" });
    expect(values).toEqual({
      "GetPlayer.GetName": "Great Britain",
      "GetPlayer.GetCountry.GetName": "Great Britain",
      "GetPlayer.GetAdjective": "British",
      "GetPlayer.GetRank": "Great Power",
      "GetPlayer.GetCountryRank.GetName": "Great Power",
      "GetPlayer.GetRuler.GetName": "William Hannover",
      "GetPlayer.GetRuler.GetFullName": "William Hannover",
      "GetPlayer.GetRuler.GetFirstName": "William",
      "GetPlayer.GetHeir.GetName": "Victoria Hannover",
      "GetPlayer.GetCapital.GetName": "Home Counties",
      "GetPlayer.GetGold": "1,247,182",
      "GetPlayer.GetBudget.GetGold": "1,247,182",
      GetCurrentDate: "21 January 1836",
      GetGameDate: "21 January 1836",
    });
  });

  it("falls back to the first main tag when no country's name matches", async () => {
    const file = saveFile("unmatched.v3", SAVE.replace('name="Great Britain"', 'name="Atlantis"'));
    const { values, source } = await readSaveValues(file, { gameId: "vic3", schema: VIC3_SAVE_SCHEMA, loc });

    expect(source.name).toBe("Atlantis");
    // GER is the first `is_main_tag=yes` entry: its money is 0 and it has no
    // heir, capital or ruler, so those keys are absent rather than invented.
    expect(values["GetPlayer.GetGold"]).toBe("0");
    expect(values["GetPlayer.GetRuler.GetName"]).toBeUndefined();
    expect(values["GetPlayer.GetCapital.GetName"]).toBeUndefined();
    expect(values["GetPlayer.GetName"]).toBe("Atlantis");
  });

  it("omits a key the save has no field for", async () => {
    const file = saveFile("noheir.v3", SAVE.replace("\their=3855\n", ""));
    const { values } = await readSaveValues(file, { gameId: "vic3", schema: VIC3_SAVE_SCHEMA, loc });

    expect(values["GetPlayer.GetHeir.GetName"]).toBeUndefined();
    expect(values["GetPlayer.GetRuler.GetName"]).toBe("William Hannover");
  });

  it("answers meta-only values for a game with no entity mapping", async () => {
    const file = saveFile("eu5.eu5", SAVE);
    const { values, source, error } = await readSaveValues(file, { gameId: "eu5", loc });

    expect(error).toBeUndefined();
    expect(source.game).toBe("eu5");
    expect(values).toEqual({
      "GetPlayer.GetName": "Great Britain",
      "GetPlayer.GetCountry.GetName": "Great Britain",
      "GetPlayer.GetRank": "Great Power",
      "GetPlayer.GetCountryRank.GetName": "Great Power",
      GetCurrentDate: "21 January 1836",
      GetGameDate: "21 January 1836",
    });
  });

  it("refuses an ironman save", async () => {
    const file = saveFile("ironman.v3", SAVE.replace("ironman=no", "ironman=yes"));
    const { values, source, error } = await readSaveValues(file, {
      gameId: "vic3",
      schema: VIC3_SAVE_SCHEMA,
      loc,
    });

    expect(error).toBe(IRONMAN_ERROR);
    expect(values).toEqual({});
    expect(source.name).toBe("Great Britain");
  });

  it("refuses a binary body", async () => {
    const file = saveFile("binary.v3", "SAV0100" + String.fromCharCode(1, 2) + " binary body");
    const { error } = await readSaveValues(file, { gameId: "vic3", schema: VIC3_SAVE_SCHEMA, loc });

    expect(error).toBe(IRONMAN_ERROR);
  });

  it("reads a zip-packed Crusader Kings III save", async () => {
    const file = saveBytes("ck3.ck3", ck3Save(CK3_GAMESTATE));
    const { values, source, error } = await readSaveValues(file, {
      gameId: "ck3",
      schema: CK3_SAVE_SCHEMA,
      loc,
    });

    expect(error).toBeUndefined();
    expect(source).toEqual({
      name: "Sultan al-Muazzam Alp Arslan",
      date: "28 October 1066",
      game: "ck3",
    });
    expect(values).toEqual({
      "GetPlayer.GetName": "Alp Arslan",
      "GetPlayer.GetFirstName": "Alp Arslan",
      "GetPlayer.GetFullName": "Alp Arslan Seljuk",
      "GetPlayer.GetAge": "37",
      "GetPlayer.GetGold": "1,814",
      "GetPlayer.GetPrestige": "708",
      "GetPlayer.GetPiety": "552",
      "GetPlayer.GetPrimaryTitle.GetName": "the Seljuk Empire",
      "GetPlayer.GetDynasty.GetName": "Seljuk",
      "GetPlayer.GetHouse.GetName": "Seljuk",
      GetCurrentDate: "28 October 1066",
      GetGameDate: "28 October 1066",
      // Fixed point, x100000; a boolean reads yes; a character variable is
      // only an id; `spiritual_root_awakened` has no value and stays absent.
      "GetPlayer.MakeScope.Var('cultivation_realm').GetValue": "3",
      "GetPlayer.MakeScope.ScriptValue('cultivation_realm')": "3",
      "GetPlayer.MakeScope.Var('chancellor_opinion_value').GetValue": "0.25",
      "GetPlayer.MakeScope.ScriptValue('chancellor_opinion_value')": "0.25",
      "GetPlayer.MakeScope.Var('crowned_emperor_var').GetValue": "yes",
      "GetPlayer.MakeScope.ScriptValue('crowned_emperor_var')": "yes",
      "GetPlayer.MakeScope.Var('my_vizier').GetValue": "30263",
      "GetPlayer.MakeScope.ScriptValue('my_vizier')": "30263",
    });
  });

  it("reads a -debug_mode save, whose gamestate is plain text", async () => {
    const file = saveFile("debug.ck3", `SAV01022428995100007dea\n${CK3_GAMESTATE}`);
    const { values, error } = await readSaveValues(file, { gameId: "ck3", schema: CK3_SAVE_SCHEMA, loc });

    expect(error).toBeUndefined();
    expect(values["GetPlayer.GetName"]).toBe("Alp Arslan");
    expect(values["GetPlayer.GetGold"]).toBe("1,814");
  });

  it("refuses an ironman Crusader Kings III save", async () => {
    const file = saveBytes("ironman.ck3", ck3Save(CK3_GAMESTATE.replace("ironman=no", "ironman=yes")));
    const { values, source, error } = await readSaveValues(file, {
      gameId: "ck3",
      schema: CK3_SAVE_SCHEMA,
      loc,
    });

    expect(error).toBe(IRONMAN_ERROR);
    expect(values).toEqual({});
    expect(source.name).toBe("Sultan al-Muazzam Alp Arslan");
  });

  it("reports a missing file instead of throwing", async () => {
    const { error } = await readSaveValues(path.join(os.tmpdir(), "px-no-such.v3"), {
      gameId: "vic3",
      schema: VIC3_SAVE_SCHEMA,
      loc,
    });

    expect(error).toMatch(/^cannot read save:/);
  });
});

describe("findZipEntry", () => {
  it("locates the entry a save's script sits in", () => {
    const body = zlib.deflateRawSync(Buffer.from("gamestate text"));
    const head = Buffer.concat([Buffer.from(CK3_HEADER), zipEntry("gamestate", body, 14)]);
    const entry = findZipEntry(head);

    expect(entry?.name).toBe("gamestate");
    expect(entry?.method).toBe(8);
    expect(entry?.compressedSize).toBe(body.length);
    expect(head.subarray(entry!.dataStart, entry!.dataStart + body.length)).toEqual(body);
  });

  it("reports no size when the sizes trail the data", () => {
    const body = zlib.deflateRawSync(Buffer.from("gamestate text"));
    const head = zipEntry("gamestate", body, 14, { streamed: true });

    expect(findZipEntry(head)?.compressedSize).toBeUndefined();
  });

  it("finds nothing in a plain-text save", () => {
    expect(findZipEntry(Buffer.from(SAVE))).toBeUndefined();
  });

  it("finds nothing when the header is cut off", () => {
    const head = zipEntry("gamestate", Buffer.from("x"), 1).subarray(0, 34);

    expect(findZipEntry(head)).toBeUndefined();
  });
});

// A real campaign: 115 MB and 6.5 million lines, so this also proves the
// streaming path never parses the whole file.
const REAL = process.env.PX_VIC3_SAVE;
const real = REAL && fs.existsSync(REAL) ? it : it.skip;

describe("readSaveValues (real save)", () => {
  real(
    "reads the played country out of a real Victoria 3 save",
    async () => {
      const { values, source, error } = await readSaveValues(REAL!, {
        gameId: "vic3",
        schema: VIC3_SAVE_SCHEMA,
        loc,
      });

      expect(error).toBeUndefined();
      expect(values["GetPlayer.GetName"]).toBe("Great Britain");
      expect(values.GetCurrentDate).toBe("21 January 1836");
      expect(source.name).toBe("Great Britain");
    },
    60_000
  );
});

// A real CK3 campaign: an 8.9 MB file whose `gamestate` entry inflates to
// 70 MB and 4.9 million lines, so this is the proof that the zip is streamed
// and the player found without holding either in memory.
const REAL_CK3 = process.env.PX_CK3_SAVE;
const realCk3 = REAL_CK3 && fs.existsSync(REAL_CK3) ? it : it.skip;

describe("readSaveValues (real CK3 save)", () => {
  realCk3(
    "reads the played character out of a real Crusader Kings III save",
    async () => {
      const { values, source, error } = await readSaveValues(REAL_CK3!, {
        gameId: "ck3",
        schema: CK3_SAVE_SCHEMA,
        loc,
      });

      expect(error).toBeUndefined();
      expect(values["GetPlayer.GetName"]).toBe("Alp Arslan");
      expect(values["GetPlayer.GetPrimaryTitle.GetName"]).toBeTruthy();
      expect(source.name).toBeTruthy();
    },
    60_000
  );
});
