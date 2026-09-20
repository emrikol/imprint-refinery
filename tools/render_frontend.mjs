import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath, startPreviewServer } from "./preview_server.mjs";

const root = process.cwd();
const output = join(root, ".impeccable", "current");
const views = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "library",
      "loading",
      "empty",
      "offline",
      "busy",
      "no-results",
      "no-blaster",
      "multiple-blasters",
      "load-error",
      "inspector",
      "inspector-signal",
      "inspector-code",
      "inspector-history",
      "inspector-malformed",
      "inspector-offline",
      "inspector-ambiguous",
      "learn-waiting",
      "learn-preparing",
      "learn-review",
      "learn-duplicate",
      "learn-optimized",
      "learn-error",
      "catalog-choices",
      "catalog",
      "catalog-empty",
      "guided",
      "guided-paused",
      "confirm",
      "profile",
      "catalog-import",
      "catalog-import-preview",
      "catalog-error",
      "lab",
      "lab-decoded",
      "lab-inferred-binary",
      "lab-compare",
      "lab-code",
      "lab-custom",
      "lab-invalid",
      "lab-offline",
      "lab-preview",
      "lab-leave",
      "lab-repeats",
      "library-unassigned",
      "dialog-locations",
      "dialog-add-appliance",
      "dialog-rename-command",
      "dialog-delete-command",
      "dialog-delete-appliance",
      "dialog-revision-restore",
      "dialog-command-move",
      "dialog-command-duplicate",
      "dialog-command-role",
      "dialog-command-icon",
      "dialog-device-move",
      "dialog-device-settings",
    ];
const sizes = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];
const server = await startPreviewServer(root);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});

try {
  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });
    await page.addInitScript(() => sessionStorage.clear());
    for (const view of views) {
      await page.goto(
        `${server.origin}/tools/browser-fixtures/preview.html?view=${encodeURIComponent(view)}`,
        { waitUntil: "networkidle" },
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.fixtureReady === "true",
      );
      await page.screenshot({
        path: join(output, `${view}-${size.name}.png`),
        fullPage: size.name === "desktop",
      });
    }
    await page.close();
  }
  const lightViews = ["library", "learn-review", "catalog", "lab"];
  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });
    await page.addInitScript(() => sessionStorage.clear());
    for (const view of lightViews) {
      await page.goto(
        `${server.origin}/tools/browser-fixtures/preview.html?view=${encodeURIComponent(view)}&theme=light`,
        { waitUntil: "networkidle" },
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.fixtureReady === "true",
      );
      await page.screenshot({
        path: join(output, `${view}-light-${size.name}.png`),
        fullPage: size.name === "desktop",
      });
    }
    await page.close();
  }
  const defectViews = [
    "library-unassigned",
    "inspector-ambiguous",
    "learn-review",
    "lab-repeats",
  ];
  for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 900 },
      deviceScaleFactor: 1,
    });
    await page.addInitScript(() => sessionStorage.clear());
    for (const view of defectViews) {
      await page.goto(
        `${server.origin}/tools/browser-fixtures/preview.html?view=${encodeURIComponent(view)}&theme=${theme}`,
        { waitUntil: "networkidle" },
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.fixtureReady === "true",
      );
      await page.screenshot({
        path: join(output, `${view}-${theme}-1024.png`),
        fullPage: true,
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  `Rendered ${(views.length + 4) * sizes.length + 8} fixture views to ${output}`,
);
