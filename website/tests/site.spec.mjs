/* global document, window */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const build = JSON.parse(readFileSync(new URL("../dist/build.json", import.meta.url), "utf8"));

test("home presents the toolkit without a side index or redundant heading", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Completion for your Paradox scripts.");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("home-desktop.png"), fullPage: true });
  await expect(page.locator(".field-index, .field-intro .eyebrow")).toHaveCount(0);
  await expect(page.locator(".project-note").getByRole("link", { name: "Joël Deffner" })).toHaveAttribute(
    "href",
    "https://jdeffner.com/"
  );
  const headings = await page.locator("main h1, main h2").allTextContents();
  expect(headings.slice(0, 4)).toEqual([
    "Completion for your Paradox scripts.",
    "Design a coat of arms.",
    "Publish to Steam Workshop.",
    "More tools for your mod.",
  ]);
  for (const feature of ["#features", "#coat-of-arms", "#workshop"]) {
    const image = page.locator(`${feature} img`);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0))
      .toBe(true);
  }
  await page.getByRole("link", { name: "Get started", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Getting Started", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("handbook full-text search, clear, no matches and failure recovery", async ({ page }) => {
  await page.goto("docs/");
  await page.keyboard.press("/");
  const field = page.getByRole("searchbox");
  await expect(field).toBeFocused();
  await field.fill("mipmaps");
  await expect(page.locator("#search-results")).toContainText("DDS & images");
  await field.fill("zzzxnonexistent");
  await expect(page.getByRole("status")).toContainText("No guides found");
  await field.clear();
  await expect(page.locator("#search-results a")).toHaveCount(0);
  await page.reload();
  await page.route("**/search.json", (route) => route.abort());
  await field.fill("setup");
  await expect(page.getByRole("status")).toContainText("Search could not load");
  await page.unroute("**/search.json");
  await field.fill("setup guide");
  await expect(page.locator("#search-results")).toContainText("VS Code Setup Guide");
});

test("mobile menu, documentation navigation, overflow and reduced motion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of [
    "./",
    "docs/",
    "docs/supported-games/",
    "docs/protocol-reference/",
    "credits/",
    "releases/",
    "brand/",
    "demos/",
  ]) {
    await page.goto(route);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      route
    ).toBe(true);
  }
  await page.goto("./");
  await page.screenshot({ path: testInfo.outputPath("home-mobile.png"), fullPage: true });
  await expect(page.getByText("On this page", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Menu/ }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Handbook", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("handbook");
  await page.getByRole("link", { name: /Getting Started/, exact: true }).click();
  await expect(page.locator(".handbook-menu")).not.toHaveAttribute("open", "");
  await page.getByText("Browse the handbook", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Handbook", exact: true })
    .getByRole("link", { name: "Supported Games" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Supported Games");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("navigation", { name: "Handbook", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator(".handbook-menu")).not.toHaveAttribute("open", "");
  await page.goto("./");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});

test("every guide loads with images and one heading", async ({ page }) => {
  await page.goto("docs/");
  const links = await page
    .locator(".docs-directory a")
    .evaluateAll((items) => items.map((item) => item.href));
  for (const link of links) {
    const response = await page.goto(link);
    expect(response.status(), link).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    const historyLink = page.getByRole("link", { name: "Page history on GitHub" });
    const href = await historyLink.getAttribute("href");
    const id = decodeURIComponent(new URL(href).pathname.split("/").at(-2));
    await expect(page.locator(".doc-meta time")).toHaveAttribute(
      "datetime",
      build.sources.pageHistory[`${id}.md`].updatedAt
    );
    await expect(page.locator(".version-note")).toHaveCount(0);
    for (const image of await page.locator(".prose img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
  }
});

test("arrows indicate external destinations, never internal pages or downloads", async ({ page }) => {
  for (const route of build.routes) {
    await page.goto(route || "./");
    const incorrect = await page
      .locator("a[href]")
      .evaluateAll((links) =>
        links
          .filter((link) => link.origin === window.location.origin && /↗|→\s*$/.test(link.textContent))
          .map((link) => ({ text: link.textContent, href: link.href }))
      );
    expect(incorrect, route).toEqual([]);
  }
  await page.goto("./");
  await expect(page.locator(".main-nav .github-link")).toContainText("↗");
  await expect(page.locator(".main-nav .button")).toContainText("↗");
});

test("header leaves on downward scroll and returns on upward scroll", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./");
    const header = page.locator(".site-header");
    await expect(header).toBeInViewport();
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: "instant" }));
    await expect
      .poll(() => header.evaluate((element) => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo({ top: 1000, behavior: "instant" }));
    await expect.poll(() => header.evaluate((element) => element.getBoundingClientRect().top)).toBe(0);
    if (width === 375) {
      await page.getByRole("button", { name: /Menu/ }).click();
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /Menu/ })).toBeFocused();
    }
  }
});

test("images enlarge in place with zoom, keyboard, focus return and backdrop dismissal", async ({
  page,
}, testInfo) => {
  for (const [route, width] of [
    ["./", 1440],
    ["docs/gui-editor/", 1440],
    ["docs/dds-and-images/", 375],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route);
    const url = page.url();
    const trigger = page.locator("[data-enlarge]").first();
    await trigger.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => window.scrollY);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Image preview" });
    await expect(dialog).toBeVisible();
    expect(page.url()).toBe(url);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect
      .poll(() => dialog.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`image-overlay-${width}-${route.includes("docs") ? "docs" : "home"}.png`),
    });
    await dialog.getByRole("button", { name: "Actual size" }).click();
    await expect(dialog.getByRole("button", { name: "Fit to window" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scroll)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(2, 2);
    await expect(dialog).not.toBeVisible();
  }
});

test("a failed image remains in the overlay with a working close action", async ({ page }) => {
  await page.goto("./");
  await page.route("**/missing-image.png", (route) => route.abort());
  const trigger = page.locator("[data-enlarge]").first();
  await trigger.evaluate((link) => {
    link.href = "missing-image.png";
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Image preview" });
  await expect(dialog.getByRole("status")).toContainText("could not load");
  await expect(dialog.getByRole("button", { name: "Actual size" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(trigger).toBeFocused();
});

test("recordings play and seek with controls and written descriptions", async ({ page }) => {
  await page.goto("demos/");
  const videos = page.locator("video");
  await expect(videos).toHaveCount(3);
  for (const video of await videos.all()) {
    await expect(video).toHaveAttribute("controls", "");
    await expect(video).not.toHaveAttribute("autoplay", "");
    const result = await video.evaluate(async (element) => {
      element.muted = true;
      await element.play();
      return { width: element.videoWidth, duration: element.duration };
    });
    expect(result.width).toBe(1600);
    expect(result.duration).toBeGreaterThan(15);
    await video.evaluate((element) => {
      element.currentTime = 8;
    });
    await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(8);
    await video.evaluate((element) => element.pause());
  }
  await expect(page.locator(".recording figcaption")).toHaveCount(3);
  await page.goto("./");
  await page.getByRole("link", { name: "Watch toolkit recordings" }).click();
  const demoVideo = page.locator("video").first();
  await demoVideo.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => demoVideo.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
});

test("missing pages return a useful 404", async ({ page }) => {
  const response = await page.goto("missing-guide/");
  expect(response.status()).toBe(404);
  await page.getByRole("link", { name: "Open the handbook", exact: true }).click();
  await expect(page.getByRole("searchbox")).toBeVisible();
});
