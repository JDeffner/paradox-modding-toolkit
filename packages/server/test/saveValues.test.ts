/**
 * Save-file preview values: the curated chain -> text mapping, read off a
 * synthetic save written by the test, plus the refusals (ironman, binary) and
 * one case gated on a real Victoria 3 save.
 *
 * Run the gated case (Git Bash):
 *   PX_VIC3_SAVE='<path to a non-ironman .v3 save>' npx vitest run test/saveValues.test.ts
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { IRONMAN_ERROR, readSaveValues } from "../src/gui/saveValues";

/** The loc index a Vic3 workspace would answer with. */
const LOC: Record<string, string> = {
  GBR: "Great Britain",
  GER: "Germany",
  GBR_ADJ: "British",
  great_power: "Great Power",
  STATE_HOME_COUNTIES: "Home Counties",
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

let dir: string | undefined;
function saveFile(name: string, text: string): string {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "px-save-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, "utf8");
  return file;
}

describe("readSaveValues", () => {
  it("maps the curated chains to values read off the save", async () => {
    const file = saveFile("vic3.v3", SAVE);
    const { values, source, error } = await readSaveValues(file, { gameId: "vic3", loc });

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
    const { values, source } = await readSaveValues(file, { gameId: "vic3", loc });

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
    const { values } = await readSaveValues(file, { gameId: "vic3", loc });

    expect(values["GetPlayer.GetHeir.GetName"]).toBeUndefined();
    expect(values["GetPlayer.GetRuler.GetName"]).toBe("William Hannover");
  });

  it("answers meta-only values for a game with no entity mapping", async () => {
    const file = saveFile("ck3.ck3", SAVE);
    const { values, source, error } = await readSaveValues(file, { gameId: "ck3", loc });

    expect(error).toBeUndefined();
    expect(source.game).toBe("ck3");
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
    const { values, source, error } = await readSaveValues(file, { gameId: "vic3", loc });

    expect(error).toBe(IRONMAN_ERROR);
    expect(values).toEqual({});
    expect(source.name).toBe("Great Britain");
  });

  it("refuses a binary body", async () => {
    const file = saveFile("binary.v3", "SAV0100" + String.fromCharCode(1, 2) + " binary body");
    const { error } = await readSaveValues(file, { gameId: "vic3", loc });

    expect(error).toBe(IRONMAN_ERROR);
  });

  it("reports a missing file instead of throwing", async () => {
    const { error } = await readSaveValues(path.join(os.tmpdir(), "px-no-such.v3"), {
      gameId: "vic3",
      loc,
    });

    expect(error).toMatch(/^cannot read save:/);
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
      const { values, source, error } = await readSaveValues(REAL!, { gameId: "vic3", loc });

      expect(error).toBeUndefined();
      expect(values["GetPlayer.GetName"]).toBe("Great Britain");
      expect(values.GetCurrentDate).toBe("21 January 1836");
      expect(source.name).toBe("Great Britain");
    },
    60_000
  );
});
