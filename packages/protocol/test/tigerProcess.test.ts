import { expect, it } from "vitest";
import { startTiger } from "../src/tigerProcess";

it("collects JSON from a successful validator and an exit-one findings run", async () => {
  const report = [{ key: "example", severity: "error", message: "Finding", locations: [] }];
  const args = ["-e", `process.stdout.write(JSON.stringify(${JSON.stringify(report)}));process.exitCode=1`];
  const result = await startTiger(process.execPath, args).result;
  expect(result.reports).toEqual(report);
  expect(result.exitCode).toBe(1);
});
it("rejects execution failures even if stdout resembles a clean report", async () => {
  await expect(
    startTiger(process.execPath, ["-e", 'process.stdout.write("[]");process.exitCode=2']).result
  ).rejects.toThrow("code 2");
});
it("accepts the numeric linenr and source-text line emitted by Tiger 1.19.0", async () => {
  const report = [
    {
      key: "unknown-field",
      severity: "error",
      message: "unknown token",
      info: null,
      locations: [
        {
          path: "common/scripted_effects/probe.txt",
          linenr: 1,
          line: "probe = { invalid = yes }",
          column: 11,
          length: 7,
          tag: null,
        },
      ],
    },
  ];
  const result = await startTiger(process.execPath, [
    "-e",
    `process.stdout.write(JSON.stringify(${JSON.stringify(report)}))`,
  ]).result;
  expect(result.reports[0].locations[0]).toMatchObject({ linenr: 1, column: 11 });
  expect(result.reports[0].severity).toBe("error");
});
it("rejects malformed entries instead of dropping them and reporting success", async () => {
  await expect(startTiger(process.execPath, ["-e", 'process.stdout.write("[{}]")']).result).rejects.toThrow(
    "incomplete JSON"
  );
});
it("rejects an unknown severity instead of treating it as a clean report", async () => {
  const report = [{ key: "example", severity: "unknown", message: "Finding", locations: [] }];
  await expect(
    startTiger(process.execPath, ["-e", `process.stdout.write(JSON.stringify(${JSON.stringify(report)}))`])
      .result
  ).rejects.toThrow("incomplete JSON");
});
it("bounds process time and output", async () => {
  await expect(
    startTiger(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 }).result
  ).rejects.toThrow("timed out");
  await expect(
    startTiger(process.execPath, ["-e", 'process.stdout.write("x".repeat(10000))'], { maxBytes: 100 }).result
  ).rejects.toThrow("size limit");
});
it("reports a missing executable", async () => {
  await expect(startTiger("pxtk-nonexistent-validator", []).result).rejects.toThrow();
});
