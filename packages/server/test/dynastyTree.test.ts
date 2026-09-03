/**
 * paradox/dynastyTree over a real vanilla excerpt: the Cerdicings, copied
 * verbatim out of CK3's own `history/characters/anglo_saxon.txt`,
 * `common/dynasties/00_dynasties.txt` and
 * `common/dynasty_houses/00_dynasty_houses.txt` (2026-09-03). Alfred is the
 * awkward case on purpose: an unquoted name, a birth block that also carries an
 * effect, a nickname block, and a marriage to a woman of another dynasty.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { clearDynastyModel, computeDynastyTree } from "../src/overview/dynastyTree";
import { ServerData } from "../src/serverData";
import type { Definition } from "@px-lsp/protocol/types";

const CHARACTERS = `7627 = {
	name = Alfred #the Great
	dynasty_house = house_british_isles_wessex
	martial = 11
	religion = catholic
	culture = anglo_saxon
	trait = honest
	trait = just
	sexuality = heterosexual
	father = 33355 #(Aethelwulf, King of Wessex)
	849.1.1 = {
		birth = yes
		effect = {
			add_character_flag = has_scripted_appearance
		}
	}
	867.1.1 = {
		add_spouse = 306020
	}
	890.1.1 = {
		give_nickname = nick_the_great
	}
	899.10.26 = {
		death = yes
	}
}
100 = {
	name = "Eadward"
	dynasty_house = house_british_isles_wessex
	religion = "catholic"
	culture = anglo_saxon
	trait = honest
	father = 7627 #Alfred the Great
	mother = 306020 #Eahlswith Mucel
	874.1.1 = {
		birth = "874.1.1"
	}
	924.7.17 = {
		death = yes
	}
}
102 = {
	name = "Eadmund"
	dynasty_house = house_british_isles_wessex
	religion = "catholic"
	culture = anglo_saxon
	father = 100
	922.1.1 = {
		birth = "922.1.1"
	}
	946.5.26 = {
		death = "946.5.26"
	}
}
306020 = {
	name = "Ealhswith"
	female = yes
	dynasty = 2004005 #Mucel
	religion = "catholic"
	culture = anglo_saxon
	849.1.1 = {
		birth = yes
	}
	902.12.5 = {
		death = yes
	}
}
`;

const DYNASTIES = `1047006 = {
	name = "dynn_Cerdicing"
	culture = "anglo_saxon"
}
2004005 = {
	name = "dynn_Mucel"
	culture = "anglo_saxon"
}
`;

const HOUSES = `house_british_isles_wessex = {
	name = "dynn_Wessex" # (100072)
	motto = dynn_Wessex_motto
	dynasty = 1047006
}
`;

let root: string;
const data = new ServerData();

const def = (name: string, kind: string, file: string): Definition => ({
  name,
  kind,
  file,
  line: 0,
  source: "vanilla",
});

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-dynasty-"));
  const write = (rel: string, text: string): string => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, "utf8");
    return full;
  };
  const chars = write("history/characters/anglo_saxon.txt", CHARACTERS);
  const dyn = write("common/dynasties/00_dynasties.txt", DYNASTIES);
  const houses = write("common/dynasty_houses/00_dynasty_houses.txt", HOUSES);
  data.index.addAll([
    ...["7627", "100", "102", "306020"].map((n) => def(n, "character", chars)),
    ...["1047006", "2004005"].map((n) => def(n, "dynasty", dyn)),
    def("house_british_isles_wessex", "dynasty_house", houses),
    // The loc index is what turns dynn_Cerdicing into a readable name.
    {
      name: "dynn_Cerdicing",
      kind: "loc_key",
      file: "loc.yml",
      line: 0,
      source: "vanilla",
      value: "Cerdicing",
    },
  ]);
  clearDynastyModel();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  clearDynastyModel();
});

describe("computeDynastyTree", () => {
  it("lists dynasties with their member and house counts, loc text resolved", () => {
    const result = computeDynastyTree(data, {});
    expect(result.supported).toBe(true);
    const cerdicing = result.dynasties.find((d) => d.id === "1047006");
    expect(cerdicing?.name).toBe("Cerdicing");
    expect(cerdicing?.culture).toBe("anglo_saxon");
    // Three characters reach the dynasty through its house.
    expect(cerdicing?.characterCount).toBe(3);
    expect(cerdicing?.houseCount).toBe(1);
    // A key with no loc entry reads as the key, never as an invented name.
    expect(result.dynasties.find((d) => d.id === "2004005")?.name).toBe("dynn_Mucel");
  });

  it("counts the next free ids from every id the index knows", () => {
    const result = computeDynastyTree(data, {});
    expect(result.nextCharacterId).toBe("306021");
    expect(result.nextDynastyId).toBe("2004006");
  });

  it("answers one dynasty with its houses and members", () => {
    const result = computeDynastyTree(data, { dynasty: "1047006" });
    expect(result.dynasty?.id).toBe("1047006");
    expect(result.houses?.map((h) => h.id)).toEqual(["house_british_isles_wessex"]);
    expect(result.houses?.[0].name).toBe("dynn_Wessex");
    expect(
      result.characters
        ?.filter((c) => !c.external)
        .map((c) => c.id)
        .sort()
    ).toEqual(["100", "102", "7627"]);
    // The picker list is not resent with a single dynasty.
    expect(result.dynasties).toEqual([]);
  });

  it("reads parents, dates, traits and spouses out of the character block", () => {
    const result = computeDynastyTree(data, { dynasty: "1047006" });
    const alfred = result.characters?.find((c) => c.id === "7627");
    expect(alfred?.name).toBe("Alfred");
    expect(alfred?.female).toBe(false);
    expect(alfred?.house).toBe("house_british_isles_wessex");
    expect(alfred?.culture).toBe("anglo_saxon");
    expect(alfred?.religion).toBe("catholic");
    // The date is the KEY of the block the statement sits in.
    expect(alfred?.birth).toBe("849.1.1");
    expect(alfred?.death).toBe("899.10.26");
    expect(alfred?.traits).toEqual(["honest", "just"]);
    expect(alfred?.spouses).toEqual(["306020"]);
    // A father outside the tree stays a plain id; nothing is invented for him.
    expect(alfred?.father).toBe("33355");

    const eadward = result.characters?.find((c) => c.id === "100");
    expect(eadward?.father).toBe("7627");
    expect(eadward?.mother).toBe("306020");
    expect(eadward?.birth).toBe("874.1.1");
  });

  it("brings in a spouse from another dynasty, marked as not this tree's", () => {
    const result = computeDynastyTree(data, { dynasty: "1047006" });
    const wife = result.characters?.find((c) => c.id === "306020");
    expect(wife?.external).toBe(true);
    expect(wife?.female).toBe(true);
    expect(wife?.dynasty).toBe("2004005");
  });

  it("answers an empty list for a dynasty nothing defines", () => {
    const result = computeDynastyTree(data, { dynasty: "9999999" });
    expect(result.dynasty).toBeUndefined();
    expect(result.supported).toBe(true);
  });
});
