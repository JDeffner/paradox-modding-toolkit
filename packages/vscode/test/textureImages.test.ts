import { afterEach, expect, it, vi } from "vitest";
import { createTextureImages } from "../src/webviews/shared/textureImages";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("batches full images and thumbnails separately and preserves loaded, missing and failed results", () => {
  vi.useFakeTimers();
  const created: Array<{ src: string; onload: () => void; onerror: () => void }> = [];
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      onload = () => undefined;
      onerror = () => undefined;
      constructor() {
        created.push(this);
      }
    }
  );
  const send = vi.fn(),
    draw = vi.fn(),
    paint = vi.fn();
  const cache = createTextureImages(send, draw, paint);
  cache.request("a", false);
  cache.request("a", false);
  cache.request("b", false);
  cache.request("a", true);
  vi.runAllTimers();
  expect(send.mock.calls.map(([message]) => message)).toEqual([
    { type: "textures", keys: ["a", "b"], thumbs: false },
    { type: "textures", keys: ["a"], thumbs: true },
  ]);
  cache.receiveTextures({ a: "full-url", b: null, broken: "bad-url" }, false);
  created[0].onload();
  created[1].onerror();
  expect(cache.images.get("a")).toBe(created[0]);
  expect(cache.images.get("b")).toBeNull();
  expect(cache.images.get("broken")).toBeNull();
  expect(draw).toHaveBeenCalledTimes(2);
  cache.receiveTextures({ a: "thumb-url" }, true);
  created[2].onload();
  expect(cache.thumbs.get("a")).toBe(created[2]);
  expect(paint).toHaveBeenCalledOnce();
  cache.request("a", false);
  cache.request("b", false);
  cache.request("a", true);
  vi.runAllTimers();
  expect(send).toHaveBeenCalledTimes(2);
  const otherPanel = createTextureImages(send, draw, paint);
  otherPanel.request("a", false);
  vi.runAllTimers();
  expect(send).toHaveBeenCalledTimes(3);
});
