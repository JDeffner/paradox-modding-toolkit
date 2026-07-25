import { describe, expect, it } from "vitest";
import { serverHeapMb } from "../src/serverHeap";

const GB = 1024 * 1024 * 1024;

describe("serverHeapMb", () => {
  it("raises an 8 GB machine above Node's ~2 GB default", () => {
    expect(serverHeapMb(8 * GB)).toBe(4096);
  });

  it("never claims more than half of physical RAM", () => {
    expect(serverHeapMb(6 * GB)).toBe(3072);
  });

  it("keeps a 2 GB floor on small machines rather than starving the index", () => {
    expect(serverHeapMb(2 * GB)).toBe(2048);
    expect(serverHeapMb(1 * GB)).toBe(2048);
  });

  it("caps at 4 GB on large machines", () => {
    expect(serverHeapMb(64 * GB)).toBe(4096);
  });
});
