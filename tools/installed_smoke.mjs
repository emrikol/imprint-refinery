import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromePath } from "./preview_server.mjs";

const [
  baseUrl,
  applianceName,
  commandName,
  expectedEntityPrefix,
  locationId,
  applianceId,
] = process.argv.slice(2);
const origin = new URL(baseUrl || "").origin;
if (
  ![
    applianceName,
    commandName,
    expectedEntityPrefix,
    locationId,
    applianceId,
  ].every(Boolean)
) {
  throw new Error(
    "Usage: installed_smoke.mjs URL APPLIANCE COMMAND ENTITY_PREFIX LOCATION_ID APPLIANCE_ID",
  );
}
const accessToken = await new Promise((resolve, reject) => {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    value += chunk;
  });
  process.stdin.on("end", () => resolve(value.trim()));
  process.stdin.on("error", reject);
});
if (!accessToken)
  throw new Error("An access token is required on standard input");

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.addInitScript(
    ({ hassUrl, token }) => {
      localStorage.setItem(
        "hassTokens",
        JSON.stringify({
          hassUrl,
          clientId: `${hassUrl}/`,
          access_token: token,
          expires: Date.now() + 240_000,
          expires_in: 300,
          refresh_token: "",
        }),
      );
    },
    { hassUrl: origin, token: accessToken },
  );

  const query = new URLSearchParams({
    screen: "library",
    location: locationId,
    appliance: applianceId,
  });
  const panelUrl = `${origin}/imprint-refinery?${query}`;
  await page.goto(panelUrl, { waitUntil: "networkidle" });
  await page.getByText(applianceName, { exact: true }).first().waitFor();
  await page
    .locator("imprint-library-browser .command-open", { hasText: commandName })
    .click();
  await page.getByText("Use in Home Assistant", { exact: true }).waitFor();
  assert.match(
    await page
      .locator("imprint-command-inspector .ha-use .muted")
      .textContent(),
    new RegExp(
      `^This command is available as ${expectedEntityPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Copy action", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.getByRole("link", { name: "Open device", exact: true }).count(),
    1,
  );
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
  );
  assert.deepEqual(consoleErrors, []);
  console.log(
    "Installed Home Assistant acceptance passed: live panel, command entity reuse, device link, desktop/mobile containment, and console.",
  );
} finally {
  await browser.close();
}
