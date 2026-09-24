import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromePath } from "./preview_server.mjs";

const [
  baseUrl,
  requestedProfileName,
  requestedApplianceName,
  requestedCommandName,
  requestedEntityId,
] = process.argv.slice(2);
const origin = new URL(baseUrl || "").origin;
if (!baseUrl) {
  throw new Error(
    "Usage: installed_smoke.mjs URL [PROFILE APPLIANCE COMMAND ENTITY_ID]",
  );
}
let profileName = requestedProfileName;
let applianceName = requestedApplianceName;
let commandName = requestedCommandName;
let expectedEntityId = requestedEntityId;
const expectedImprintElements = [
  "imprint-refinery-card",
  "imprint-refinery-panel",
  "imprint-signal-lab",
  "imprint-signal-waveform",
  "imprint-waveform-comparison",
];

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

const browserHostIp = process.env.IMPRINT_BROWSER_HOST_IP;
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    "--disable-background-networking",
    "--disable-features=NetworkChangeNotifier",
    ...(browserHostIp
      ? [`--host-resolver-rules=MAP ${new URL(baseUrl).hostname} ${browserHostIp}`]
      : []),
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
const requestFailures = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("requestfailed", (request) => {
  requestFailures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || "failed"}`);
});

const noOverflow = async (targetPage, label) => {
  const metrics = await targetPage.locator("imprint-refinery-panel").evaluate((element) => {
    const app = element.shadowRoot?.querySelector(".app");
    return {
      hostClient: element.clientWidth,
      hostScroll: element.scrollWidth,
      appClient: app?.clientWidth || 0,
      appScroll: app?.scrollWidth || 0,
    };
  });
  assert.equal(
    metrics.appScroll <= metrics.appClient,
    true,
    `${label} overflowed horizontally: ${JSON.stringify(metrics)}`,
  );
};

const waitForDialogOpen = async (targetPage, workflow) => {
  await workflow.waitFor({ state: "attached" });
  const handle = await workflow.elementHandle();
  assert.ok(handle, "Workflow dialog did not attach");
  await targetPage.waitForFunction(
    (dialog) => Boolean(dialog?.shadowRoot?.querySelector("wa-dialog")?.open),
    handle,
  );
};

try {
  await page.addInitScript(
    ({ hassUrl, token }) => {
      const registeredImprintElements = [];
      Object.defineProperty(window, "__imprintRegisteredElements", {
        configurable: false,
        value: registeredImprintElements,
      });
      const originalDefine = CustomElementRegistry.prototype.define;
      CustomElementRegistry.prototype.define = function (name, constructor, options) {
        if (name.startsWith("imprint-")) registeredImprintElements.push(name);
        return originalDefine.call(this, name, constructor, options);
      };
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

  await page.goto(`${origin}/imprint-refinery/remote-profiles`, {
    waitUntil: "networkidle",
  });
  try {
    await page.getByRole("heading", { name: "Remote profiles", exact: true }).waitFor();
  } catch (error) {
    const body = (await page.locator("body").innerText()).slice(0, 500);
    const title = await page.title();
    const shell = await page.evaluate(() => ({
      body: document.body.innerHTML.slice(0, 500),
      homeAssistant: document.querySelector("home-assistant")?.shadowRoot?.innerHTML.slice(0, 500) || "",
    }));
    throw new Error(`Imprint panel did not load at ${page.url()} (${title}): ${body}\n${JSON.stringify(shell)}\n${consoleErrors.join("\n")}`, {
      cause: error,
    });
  }
  try {
    await page.waitForFunction(
      () => {
        const required = [...(window.__imprintRequiredHaComponents || [])];
        return required.length > 0 && required.every((tagName) => customElements.get(tagName));
      },
      undefined,
      { timeout: 10_000 },
    );
  } catch (error) {
    const availability = await page.evaluate(() => {
      const required = [...(window.__imprintRequiredHaComponents || [])];
      return {
        required,
        missing: required.filter((tagName) => !customElements.get(tagName)),
      };
    });
    throw new Error(
      `Home Assistant component contract was not ready: ${JSON.stringify(availability)}; request failures: ${JSON.stringify(requestFailures)}`,
      { cause: error },
    );
  }
  const homeAssistantComponentContract = await page.evaluate(() => {
    const required = [...(window.__imprintRequiredHaComponents || [])];
    return {
      required,
      missing: required.filter((tagName) => !customElements.get(tagName)),
    };
  });
  assert.ok(
    homeAssistantComponentContract.required.length > 0,
    "Imprint did not publish its Home Assistant component contract",
  );
  assert.deepEqual(
    homeAssistantComponentContract.missing,
    [],
    `Home Assistant did not load required frontend components: ${homeAssistantComponentContract.missing.join(", ")}`,
  );
  const imprintElementContract = await page.evaluate((expected) => ({
    registered: [...new Set(window.__imprintRegisteredElements || [])].sort(),
    missing: expected.filter((tagName) => !customElements.get(tagName)),
  }), expectedImprintElements);
  assert.deepEqual(
    imprintElementContract.registered,
    [...expectedImprintElements].sort(),
    "The installed bundle did not register exactly the five allowed Imprint elements",
  );
  assert.deepEqual(
    imprintElementContract.missing,
    [],
    `Installed Imprint elements did not upgrade: ${imprintElementContract.missing.join(", ")}`,
  );
  if (![profileName, applianceName, commandName, expectedEntityId].every(Boolean)) {
    const snapshot = await page.locator("imprint-refinery-panel").evaluate(
      (element) =>
        element.hass.callWS({
          type: "imprint_refinery/execute",
          action: "get_library",
          data: {},
        }),
    );
    const library = snapshot.response ?? snapshot;
    const installedAppliance = Object.values(library.appliances)[0];
    assert.ok(installedAppliance, "No installed appliance exists");
    const installedProfile =
      library.remote_profiles[installedAppliance.remote_profile_id];
    assert.ok(installedProfile, "The installed appliance has no remote profile");
    const installedCommand = Object.values(installedProfile.commands).find(
      (command) => Array.isArray(command.signal?.timings) && command.signal.timings.length,
    );
    assert.ok(installedCommand, "The installed remote profile has no command with timing data");
    profileName ||= installedProfile.name;
    applianceName ||= installedAppliance.name;
    commandName ||= installedCommand.name;
    expectedEntityId ||= installedAppliance.home_assistant?.entity_id;
    assert.ok(expectedEntityId, "The installed appliance has no entity");
  }
  const profile = page.locator(".profile", { hasText: profileName });
  await profile.getByRole("heading", { name: profileName, exact: true }).waitFor();

  await profile
    .getByRole("button", {
      name: "Create appliance from this remote profile",
      exact: true,
    })
    .click();
  const createApplianceWorkflow = page.locator('[data-workflow="appliance"]');
  await waitForDialogOpen(page, createApplianceWorkflow);
  await createApplianceWorkflow.getByLabel("Remote profile").click();
  await page.keyboard.press("Escape");
  assert.equal(
    await createApplianceWorkflow.evaluate(
      (dialog) => Boolean(dialog.shadowRoot?.querySelector("wa-dialog")?.open),
    ),
    true,
    "Closing a nested select dismissed the appliance workflow",
  );
  await createApplianceWorkflow
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await createApplianceWorkflow.waitFor({ state: "detached" });

  await profile
    .getByRole("button", { name: new RegExp(`^Actions for ${profileName}$`) })
    .click();
  await page.getByRole("menuitem", { name: "Delete profile", exact: true }).click();
  const destructiveWorkflow = page.locator('[data-workflow="confirmation"]');
  await waitForDialogOpen(page, destructiveWorkflow);
  assert.equal(
    await destructiveWorkflow.getByRole("button", { name: "Delete", exact: true }).isDisabled(),
    true,
    "A shared profile deletion was not blocked",
  );
  await destructiveWorkflow
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await destructiveWorkflow.waitFor({ state: "detached" });

  await profile.locator(".command-open", { hasText: commandName }).click();
  const commandInspector = page.getByLabel("Command details", { exact: true });
  await commandInspector.waitFor();
  const action = await commandInspector.locator("pre", {
    hasText: "action: remote.send_command",
  }).textContent();
  assert.match(action || "", new RegExp(`entity_id: ${expectedEntityId}$`, "m"));
  assert.equal(
    await commandInspector.getByRole("button", { name: "Copy action", exact: true }).count(),
    1,
  );
  assert.equal(
    await commandInspector.getByRole("link", { name: "Open HA device", exact: true }).count(),
    1,
  );
  await commandInspector.getByRole("button", { name: "Edit", exact: true }).click();
  const editWorkflow = page.locator('[data-workflow="edit-command"]');
  await waitForDialogOpen(page, editWorkflow);
  assert.equal(
    await editWorkflow.evaluate((element) => element.headerTitle),
    "Edit command",
  );
  await editWorkflow.getByRole("button", { name: "Cancel", exact: true }).click();
  await editWorkflow.waitFor({ state: "detached" });
  await commandInspector.waitFor();
  await commandInspector
    .getByRole("button", { name: "Open in Signal Lab", exact: true })
    .click();
  await page.getByRole("heading", { name: "Signal Lab", exact: true }).waitFor();
  await page.locator("imprint-signal-lab").waitFor();
  await page
    .getByRole("button", { name: "Return to remote profiles", exact: true })
    .click();
  await page.getByRole("heading", { name: "Remote profiles", exact: true }).waitFor();

  await page.getByRole("tab", { name: "Appliances", exact: true }).click();
  await page.getByRole("heading", { name: "Appliances", exact: true }).waitFor();
  const appliance = page.locator(".appliance", { hasText: applianceName });
  await appliance.getByRole("heading", { name: applianceName, exact: true }).waitFor();
  assert.equal(
    await appliance.getByRole("link", { name: "Open HA device", exact: true }).count(),
    1,
  );
  await appliance.getByRole("button", { name: `Actions for ${applianceName}`, exact: true }).click();
  await appliance.getByText("Open remote profile", { exact: true }).click();
  await page.locator(".profile.route-target", { hasText: profileName }).waitFor();
  assert.match(page.url(), /\/imprint-refinery\/remote-profiles\//);

  await page.getByRole("tab", { name: "Infrared hardware", exact: true }).click();
  await page.getByRole("heading", { name: "Infrared hardware", exact: true }).waitFor();
  assert.equal(await page.getByText("IR emitters", { exact: true }).count(), 1);
  assert.equal(await page.getByText("IR receivers", { exact: true }).count(), 1);
  assert.ok((await page.locator(".hardware-row-primary").count()) > 0);
  await noOverflow(page, "installed desktop workspace");

  const cardContract = await page.locator("imprint-refinery-panel").evaluate(
    async (panel) => {
      const host = document.createElement("div");
      host.style.width = "390px";
      host.style.position = "fixed";
      host.style.inset = "0 auto auto -10000px";
      const card = document.createElement("imprint-refinery-card");
      card.setConfig({});
      card.hass = panel.hass;
      host.append(card);
      document.body.append(host);
      try {
        await card.updateComplete;
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const shell = card.shadowRoot?.querySelector(".shell");
        const cardRect = card.getBoundingClientRect();
        const overflowers = [...(card.shadowRoot?.querySelectorAll("*") || [])]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.localName,
              className: element.className || "",
              client: element.clientWidth,
              scroll: element.scrollWidth,
              width: Math.round(rect.width),
              right: Math.round(rect.right - cardRect.right),
            };
          })
          .filter((item) => item.scroll > item.client || item.right > 0)
          .slice(0, 12);
        return {
          shellTag: shell?.localName || "",
          shellClient: shell?.clientWidth || 0,
          shellScroll: shell?.scrollWidth || 0,
          hostClient: card.clientWidth,
          hostScroll: card.scrollWidth,
          appClient: card.shadowRoot?.querySelector(".app")?.clientWidth || 0,
          appScroll: card.shadowRoot?.querySelector(".app")?.scrollWidth || 0,
          minHeight: shell ? getComputedStyle(shell).minHeight : "",
          presentation: card.presentation,
          overflowers,
        };
      } finally {
        host.remove();
      }
    },
  );
  assert.equal(cardContract.shellTag, "ha-card");
  assert.equal(cardContract.presentation, "card");
  assert.equal(
    cardContract.hostScroll <= cardContract.hostClient &&
      cardContract.appScroll <= cardContract.appClient,
    true,
    `The installed Lovelace-card entry contract overflowed: ${JSON.stringify(cardContract)}`,
  );
  assert.doesNotMatch(cardContract.minHeight, /100dvh/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "installed mobile workspace");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Infrared hardware", exact: true }).waitFor();
  await noOverflow(page, "installed hard-refresh workspace");

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobilePage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  mobilePage.on("pageerror", (error) => consoleErrors.push(error.message));
  mobilePage.on("requestfailed", (request) => {
    requestFailures.push(
      `${request.method()} ${request.url()} — ${request.failure()?.errorText || "failed"}`,
    );
  });
  await mobilePage.addInitScript(
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
  await mobilePage.goto(`${origin}/imprint-refinery/remote-profiles`, {
    waitUntil: "networkidle",
  });
  await mobilePage
    .getByRole("heading", { name: "Remote profiles", exact: true })
    .waitFor();
  await noOverflow(mobilePage, "fresh installed phone session");
  await mobilePage.reload({ waitUntil: "networkidle" });
  await mobilePage
    .getByRole("heading", { name: "Remote profiles", exact: true })
    .waitFor();
  await noOverflow(mobilePage, "fresh installed phone hard refresh");
  await mobilePage.close();

  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(requestFailures, []);
  console.log(
    "Installed Home Assistant acceptance passed: exact element contract, create/edit/destructive workflows, nested-overlay ownership, profile, Inspector, Signal Lab, appliance, standard action, deep link, hardware inventory, card/panel entry modes, device links, fresh desktop/phone hard refresh, containment, console, and network requests.",
  );
} finally {
  await browser.close();
}
