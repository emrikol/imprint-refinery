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
      "appliances",
      "infrared-hardware",
      "appliance-dialog",
      "learn-dialog",
      "learn-waiting",
      "learn-review",
      "learn-error",
      "no-receiver-dialog",
      "profile-dialog",
      "catalog-dialog",
      "confirmation-dialog",
      "icon-dialog",
      "bulk-selection",
      "backup-dialog",
      "import-dialog",
      "command-inspector",
      "command-edit",
      "command-duplicate",
      "signal-lab",
      "empty",
      "unconfigured-appliance",
      "offline",
      "no-blaster",
      "compatibility-adapter-hardware",
      "loading",
      "load-error",
    ];
const sizes = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "narrow", width: 1100, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const lightViews = [
  "library",
  "appliances",
  "infrared-hardware",
  "command-inspector",
  "command-edit",
  "command-duplicate",
  "icon-dialog",
  "bulk-selection",
  "signal-lab",
  "unconfigured-appliance",
  "offline",
  "load-error",
];
const embeddedViews = ["library", "appliances", "command-inspector", "signal-lab"];
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
    page.on("pageerror", (error) => {
      console.error(`Fixture page error (${size.name}): ${error.message}`);
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
  const embeddedPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  await embeddedPage.addInitScript(() => sessionStorage.clear());
  for (const view of embeddedViews) {
    await embeddedPage.goto(
      `${server.origin}/tools/browser-fixtures/preview.html?view=${encodeURIComponent(view)}&hostWidth=390`,
      { waitUntil: "networkidle" },
    );
    await embeddedPage.waitForFunction(
      () => document.documentElement.dataset.fixtureReady === "true",
    );
    await embeddedPage.screenshot({
      path: join(output, `${view}-container-390.png`),
      fullPage: true,
    });
  }
  await embeddedPage.close();
  const defectViews = ["offline", "no-blaster", "empty", "unconfigured-appliance"];
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
  `Rendered ${views.length * sizes.length + lightViews.length * sizes.length + 8 + embeddedViews.length} fixture views to ${output}`,
);
