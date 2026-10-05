import { expect, it } from "vitest";
import { encodeDds } from "@px-lsp/server/dds/encode";
import { adjustDdsMipLevels } from "@px-lsp/server/dds/migrateMips";
import { migrationBinaryReview } from "../src/compatch/migrationBinaryReview";

it("shows the captured format, dimensions and before/after mip chain", () => {
  const before = encodeDds(8, 8, new Uint8Array(8 * 8 * 4).fill(255), "bgra8");
  const after = adjustDdsMipLevels(before, 2);
  const review = migrationBinaryReview("gfx/portrait/mask.dds", before, after, "plan-hash");
  expect(review).toContain("Dimensions: 8 x 8");
  expect(review).toContain("Stored mip levels: 1 (includes the base image)");
  expect(review).toContain("Stored mip levels: 2 (includes the base image)");
  expect(review).toContain("Level 1: 4 x 4");
  expect(review).toContain("Plan: plan-hash");
  expect(review).toContain("do not establish");
});

it("reports unreadable DDS bytes explicitly and describes generic binary changes", () => {
  expect(migrationBinaryReview("bad.dds", new Uint8Array(4), undefined, "hash")).toContain(
    "DDS metadata could not be read"
  );
  expect(migrationBinaryReview("item.bin", undefined, new Uint8Array(3), "hash")).toContain("After: 3 bytes");
});
