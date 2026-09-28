/* global document */
import { test, expect } from "@playwright/test";

test("home, task index, navigation and rendered desktop layout", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paradox modding,from script to screen.");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("home-desktop.png"), fullPage: true });
  const index = page.getByRole("navigation", { name: "Toolkit guide" });
  await index.getByRole("link", { name: "See the interface" }).click();
  await expect(page.locator("#interfaces")).toBeInViewport();
  await expect(index.getByRole("link", { name: "See the interface" })).toHaveAttribute(
    "aria-current",
    "location"
  );
  await expect(page.locator("#interfaces .source-pane")).toContainText('name = "cultivation_hud"');
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
  await page.getByText("On this page", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Toolkit guide" })
    .getByRole("link", { name: "Finish the details" })
    .click();
  await expect(page.locator("#tools")).toBeInViewport();
  await page.goto("./");
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
  await expect(page.getByRole("navigation", { name: "Toolkit guide" })).toBeVisible();
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
    for (const image of await page.locator(".prose img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
  }
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
  await expect(page.getByRole("link", { name: /Watch all three workflows/ })).toBeVisible();
  const homeVideo = page.locator("video");
  await homeVideo.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => homeVideo.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
});

test("missing pages return a useful 404", async ({ page }) => {
  const response = await page.goto("missing-guide/");
  expect(response.status()).toBe(404);
  await page.getByRole("link", { name: "Open the handbook", exact: true }).click();
  await expect(page.getByRole("searchbox")).toBeVisible();
});
