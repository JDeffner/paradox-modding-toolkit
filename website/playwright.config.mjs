import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

const { base } = JSON.parse(readFileSync(new URL("./dist/build.json", import.meta.url), "utf8"));
export default defineConfig({
  testDir: "./tests",
  workers: 2,
  use: {
    baseURL: `http://127.0.0.1:4321${base}`,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "pnpm preview",
    url: `http://127.0.0.1:4321${base}`,
    reuseExistingServer: !process.env.CI,
  },
});
