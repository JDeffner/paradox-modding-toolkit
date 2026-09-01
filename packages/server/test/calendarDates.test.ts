import { describe, expect, it } from "vitest";
import { dateTokensOnLine } from "../src/features/calendarDates";
import type { CalendarSetting } from "@px-lsp/protocol/calendar";

const CAL: CalendarSetting = { epoch: 4000, after: "AD", before: "BC" };

const dates = (line: string) => dateTokensOnLine(CAL, line).map((t) => `${t.y}.${t.m}.${t.d}`);

describe("dateTokensOnLine", () => {
  it("finds dates as keys and values, several per line", () => {
    expect(dates("3000.1.1 = {")).toEqual(["3000.1.1"]);
    expect(dates("set_variable = { value = 3500.6.12 }")).toEqual(["3500.6.12"]);
    expect(dates("start = 3000.1.1 end = 3050.2.2")).toEqual(["3000.1.1", "3050.2.2"]);
  });

  it("skips comments and quoted strings (version numbers are quoted)", () => {
    expect(dates('supported_version = "1.12.3"')).toEqual([]);
    expect(dates("birth = 3000.1.1 # was 2999.1.1")).toEqual(["3000.1.1"]);
    // A `#` inside a quoted value does not start the comment tail.
    expect(dates('name = "a # b" birth = 3000.1.1')).toEqual(["3000.1.1"]);
  });

  it("skips runs glued into longer tokens and non-dates", () => {
    expect(dates("trigger_event = my_mod.3000.1.1")).toEqual([]);
    expect(dates("factor = 0.5")).toEqual([]);
    expect(dates("date = 3000.13.1")).toEqual([]); // month 13 is not a date
    expect(dates("date = 3000.2.29")).toEqual([]); // no leap years
  });
});
