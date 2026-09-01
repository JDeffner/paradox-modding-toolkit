import { describe, expect, it } from "vitest";
import {
  convertDisplayInput,
  displayDate,
  displayYear,
  parseScriptDate,
  sanitizeCalendar,
  type CalendarSetting,
} from "../src/calendar";

// Hegemonia's declared rule: 3000 -> 1000 BC, 4000 -> 1 AD.
const HEGEMONIA: CalendarSetting = { epoch: 4000, after: "AD", before: "BC" };

const SHIRE: CalendarSetting = {
  epoch: 1,
  after: "TA",
  months: [
    { name: "Afteryule", days: 30 },
    { name: "Solmath", days: 30 },
    { name: "Rethe", days: 30 },
  ],
};

describe("displayYear", () => {
  it("maps the epoch boundary with no year zero", () => {
    expect(displayYear(HEGEMONIA, 3999)).toBe("1 BC");
    expect(displayYear(HEGEMONIA, 4000)).toBe("1 AD");
    expect(displayYear(HEGEMONIA, 4001)).toBe("2 AD");
    expect(displayYear(HEGEMONIA, 3000)).toBe("1000 BC");
  });

  it("single-era calendar has no display for pre-epoch years", () => {
    const cal: CalendarSetting = { epoch: 100, after: "TA" };
    expect(displayYear(cal, 99)).toBeNull();
    expect(displayYear(cal, 100)).toBe("1 TA");
  });
});

describe("displayDate", () => {
  it("year-only form on the year's first day, full form otherwise", () => {
    expect(displayDate(HEGEMONIA, 3000, 1, 1)).toBe("1000 BC");
    expect(displayDate(HEGEMONIA, 3000, 3, 15)).toBe("15 March 1000 BC");
  });

  it("rejects dates outside the calendar", () => {
    expect(displayDate(HEGEMONIA, 3000, 13, 1)).toBeNull();
    expect(displayDate(HEGEMONIA, 3000, 2, 29)).toBeNull(); // no leap years
    expect(displayDate(SHIRE, 5, 4, 1)).toBeNull(); // only 3 months declared
  });

  it("uses custom month names and day counts", () => {
    expect(displayDate(SHIRE, 5, 2, 30)).toBe("30 Solmath 5 TA");
  });
});

describe("parseScriptDate", () => {
  it("accepts Y.M.D and nothing else", () => {
    expect(parseScriptDate("3000.1.1")).toEqual({ y: 3000, m: 1, d: 1 });
    expect(parseScriptDate("3000.1")).toBeNull();
    expect(parseScriptDate("namespace.5.a")).toBeNull();
  });
});

describe("convertDisplayInput", () => {
  const convert = (input: string) => {
    const r = convertDisplayInput(HEGEMONIA, input);
    return r.ok ? r.script : `error: ${r.error}`;
  };

  it("round-trips the requester's examples", () => {
    expect(convert("1000 BC")).toBe("3000.1.1");
    expect(convert("500 BC")).toBe("3500.1.1");
    expect(convert("1 AD")).toBe("4000.1.1");
  });

  it("era defaults to the after label", () => {
    expect(convert("500")).toBe("4499.1.1");
  });

  it("takes month and day, numeric or by name (case-insensitive prefix)", () => {
    expect(convert("1000 BC 3 15")).toBe("3000.3.15");
    expect(convert("1000 BC March 15")).toBe("3000.3.15");
    expect(convert("1000 BC mar 15")).toBe("3000.3.15");
  });

  it("ambiguous month prefixes are errors, not guesses", () => {
    const r = convertDisplayInput(HEGEMONIA, "1000 BC ma 15"); // March | May
    expect(r.ok).toBe(false);
  });

  it("rejects what the calendar cannot hold", () => {
    expect(convertDisplayInput(HEGEMONIA, "0 AD").ok).toBe(false); // no year zero
    expect(convertDisplayInput(HEGEMONIA, "4000 BC").ok).toBe(false); // before script year 1
    expect(convertDisplayInput(HEGEMONIA, "1 AD 2 30").ok).toBe(false); // Feb has 28
    expect(convertDisplayInput(HEGEMONIA, "next tuesday").ok).toBe(false);
  });

  it("custom months by name", () => {
    const r = convertDisplayInput(SHIRE, "5 TA Solmath 30");
    expect(r).toEqual({ ok: true, script: "5.2.30", display: "30 Solmath 5 TA" });
  });
});

describe("sanitizeCalendar", () => {
  it("accepts the documented shape and trims labels", () => {
    expect(sanitizeCalendar({ epoch: 4000, after: " AD ", before: "BC" })).toEqual(HEGEMONIA);
  });

  it("rejects anything unusable rather than half-working", () => {
    expect(sanitizeCalendar(null)).toBeUndefined();
    expect(sanitizeCalendar({ epoch: 0, after: "AD" })).toBeUndefined();
    expect(sanitizeCalendar({ epoch: 4000, after: "" })).toBeUndefined();
    expect(sanitizeCalendar({ epoch: 4000, after: "AD", months: [{ name: "X", days: 0 }] })).toBeUndefined();
  });

  it("rejects labels and month names that cannot be told apart", () => {
    expect(sanitizeCalendar({ epoch: 4000, after: "TA", before: "ta" })).toBeUndefined();
    expect(
      sanitizeCalendar({
        epoch: 4000,
        after: "TA",
        months: [
          { name: "Moon", days: 30 },
          { name: " moon ", days: 30 },
        ],
      })
    ).toBeUndefined();
  });

  it("drops an empty months array back to the default calendar", () => {
    expect(sanitizeCalendar({ epoch: 4000, after: "AD", months: [] })).toEqual({
      epoch: 4000,
      after: "AD",
    });
  });
});
