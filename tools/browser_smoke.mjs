import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromePath, startPreviewServer } from "./preview_server.mjs";

const server = await startPreviewServer();
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const observedCalls = [];
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

const open = async (
  view,
  { width, height, theme = "dark", preserveSession = false } = {},
) => {
  if (width && height) await page.setViewportSize({ width, height });
  if (!preserveSession && page.url().startsWith(server.origin))
    await page.evaluate(() => sessionStorage.clear());
  await page.goto(
    `${server.origin}/tools/browser-fixtures/preview.html?view=${view}&theme=${theme}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
};

const assertNoHorizontalOverflow = async (label) =>
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
    `${label} overflowed horizontally`,
  );

const boxesOverlap = (a, b) =>
  Boolean(
    a &&
      b &&
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y,
  );

try {
  await open("library", { width: 1440, height: 1000 });
  await page
    .getByText("Living room emitter", { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.getByText("10 saved commands", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Restore library", exact: true })
      .count(),
    0,
    "Restore remained loose in the Library footer",
  );
  const libraryTools = page.getByRole("button", {
    name: "Library tools",
    exact: true,
  });
  await libraryTools.press("ArrowDown");
  assert.equal(
    await page
      .getByRole("button", { name: "Restore library", exact: true })
      .count(),
    1,
    "Library menu did not expose Restore",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("imprint-library-browser details.library-menu[open]")
      .count(),
    0,
    "Escape did not close the Library menu",
  );
  assert.equal(
    await libraryTools.evaluate(
      (element) => element.getRootNode().activeElement === element,
    ),
    true,
    "Library menu did not return focus to its trigger",
  );
  await page
    .getByRole("button", { name: "Add appliance", exact: true })
    .click();
  const addApplianceDialog = page.getByRole("dialog", {
    name: "Add appliance",
  });
  await addApplianceDialog.waitFor();
  assert.equal(
    await page
      .locator("imprint-dialog input[autofocus]")
      .getAttribute("placeholder"),
    "e.g. Floor lamp",
    "Add appliance prompt was not a real placeholder",
  );
  await addApplianceDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  assert.equal(
    await page
      .locator("imprint-command-inspector .metric > span", {
        hasText: /^Evidence$/,
      })
      .count(),
    0,
    "Inspector repeated recognition evidence as a metric tile",
  );
  await page.evaluate(
    () =>
      import(
        "/custom_components/imprint_refinery/www/imprint-refinery-card.js?duplicate-load-smoke"
      ),
  );
  await page.getByText("Use in Home Assistant", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText("This command is available as media_player.television.", {
        exact: true,
      })
      .count(),
    1,
    "Inspector did not expose the projected Home Assistant entity",
  );
  await page.getByRole("button", { name: "Copy action", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Copy entity ID", exact: true })
      .count(),
    1,
    "Inspector did not expose entity-ID reuse",
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Open device", exact: true })
      .getAttribute("href"),
    "/config/devices/device/fixture-tv",
    "Inspector did not link to the Home Assistant device",
  );
  await page
    .locator("imprint-library-browser .command-open", { hasText: "Input" })
    .click();
  await page
    .locator("imprint-command-inspector .head h2", { hasText: "Input" })
    .waitFor();
  assert.equal(
    await page
      .locator("imprint-command-inspector pre.code", {
        hasText: "media_player.select_source",
      })
      .count(),
    1,
    "Inspector did not reuse the native source-selection action",
  );
  await page
    .locator("imprint-library-browser .command-open", { hasText: "Power" })
    .first()
    .click();
  await page
    .locator("imprint-command-inspector .head h2", { hasText: "Power" })
    .waitFor();
  await page.getByRole("tab", { name: "Code" }).click();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByText("Revision 4", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Signal" }).click();
  await page.getByRole("button", { name: "Open in Signal Lab" }).click();
  await page.getByText("Signal Lab", { exact: true }).waitFor();
  await page.getByText("Optimize for one press", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Compare" }).click();
  await page
    .locator("button:visible")
    .filter({ hasText: "+10" })
    .first()
    .click();
  await page.getByRole("button", { name: "Return to command library" }).click();
  await page.getByRole("button", { name: "Continue editing" }).click();
  observedCalls.push(
    ...(await page.evaluate(() => window.__IMPRINT_REFINERY_FIXTURES__.calls)),
  );

  await open("library", { width: 1440, height: 1000 });
  await page
    .locator("imprint-library-browser .command-open", { hasText: "Power" })
    .first()
    .click();
  await page.getByRole("tab", { name: "Signal", exact: true }).click();
  await page
    .locator("imprint-command-inspector")
    .getByRole("button", { name: "Zoom in" })
    .click();
  assert.equal(
    await page
      .locator("imprint-command-inspector imprint-waveform")
      .evaluate((element) => element.zoom),
    2,
    "Inspector signal zoom did not change",
  );
  await page
    .locator("imprint-library-browser .command-open", { hasText: "Volume up" })
    .first()
    .click();
  assert.equal(
    await page
      .getByRole("tab", { name: "Signal", exact: true })
      .getAttribute("aria-selected"),
    "true",
    "Inspector tab reset when a different command was selected",
  );
  assert.equal(
    await page
      .locator("imprint-command-inspector imprint-waveform")
      .evaluate((element) => element.zoom),
    2,
    "Inspector signal view reset when a different command was selected",
  );
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await page.getByText("Raw bitstream", { exact: true }).waitFor();
  assert(
    (
      await page.evaluate(() => window.__IMPRINT_REFINERY_FIXTURES__.calls)
    ).some((call) => (call.action || call.service) === "analyze_signal"),
    "stored command analysis was not refreshed for the new binary decoder",
  );
  await page
    .locator("imprint-command-inspector label.field", {
      hasText: "Bitstream decoder",
    })
    .locator("select")
    .selectOption("pulse_distance");
  assert.equal(
    await page.getByText("100% timing fit", { exact: true }).count(),
    1,
    "manual timing decoder did not expose its fit score",
  );
  await page
    .locator("imprint-command-inspector label.field", {
      hasText: "Representation",
    })
    .locator("select")
    .selectOption("pronto");
  await page
    .locator("imprint-command-inspector pre.code", { hasText: /^0000 006D/ })
    .waitFor();
  await page
    .locator("imprint-library-browser .command-open", { hasText: "Power" })
    .first()
    .click();
  assert.equal(
    (
      await page.locator("imprint-command-inspector .head h2").textContent()
    )?.trim(),
    "Volume up",
    "Inspector replaced the command before its selected representation was ready",
  );
  assert.equal(
    await page.getByText("Converting representation…", { exact: true }).count(),
    0,
    "command switching flashed a conversion placeholder",
  );
  await page
    .locator("imprint-command-inspector .head h2", { hasText: "Power" })
    .waitFor();
  await page
    .locator("imprint-library-browser .command-open", { hasText: "Volume up" })
    .first()
    .click();
  assert.equal(
    (
      await page.locator("imprint-command-inspector .head h2").textContent()
    )?.trim(),
    "Volume up",
    "cached representation did not switch atomically",
  );
  assert.equal(
    await page
      .locator("imprint-command-inspector label.field", {
        hasText: "Bitstream decoder",
      })
      .locator("select")
      .inputValue(),
    "pulse_distance",
    "manual bitstream decoder reset when a different command was selected",
  );
  assert.equal(
    await page.getByText("Converting representation…", { exact: true }).count(),
    0,
    "cached command switch flashed a conversion placeholder",
  );

  await open("library", { width: 1024, height: 900 });
  const rememberedSearch = page.getByPlaceholder(
    "Search appliances and commands",
  );
  await rememberedSearch.fill("Volume");
  await page
    .locator("imprint-library-browser .command-open", { hasText: "Volume up" })
    .first()
    .click();
  await page.getByRole("tab", { name: "Signal", exact: true }).click();
  await page.getByRole("button", { name: "Open in Signal Lab" }).click();
  await page.getByRole("button", { name: "Return to command library" }).click();
  assert.equal(
    await rememberedSearch.inputValue(),
    "Volume",
    "Library search was lost after returning from Signal Lab",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  assert.equal(
    await page.getByPlaceholder("Search appliances and commands").inputValue(),
    "Volume",
    "Library search was lost after refresh",
  );
  await page.getByPlaceholder("Search appliances and commands").fill("");
  await page.getByLabel("Filter by location").selectOption("living_room");
  assert.equal(
    JSON.parse(
      await page.evaluate(
        () =>
          sessionStorage.getItem("imprint-refinery.library-view.v1") || "{}",
      ),
    )?.locationFilter,
    "living_room",
    "Library location filter was not persisted when changed",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  const restoredLocationState = JSON.parse(
    await page.evaluate(
      () => sessionStorage.getItem("imprint-refinery.library-view.v1") || "{}",
    ),
  );
  assert.equal(
    await page.getByLabel("Filter by location").inputValue(),
    "living_room",
    `Library location filter was lost after refresh: ${JSON.stringify(restoredLocationState)}`,
  );

  await open("library", { width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Select commands in Television" })
    .click();
  await page
    .locator("imprint-library-browser .selection-bar input[type=checkbox]")
    .check();
  await page.getByText("5 selected", { exact: true }).waitFor();
  assert.equal(
    await page
      .locator("imprint-library-browser .command.multi-selected")
      .count(),
    5,
    "Select all did not select every command in the appliance group",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await page.getByText("5 selected", { exact: true }).waitFor();
  assert.equal(
    await page
      .locator("imprint-library-browser .command.multi-selected")
      .count(),
    5,
    "Command selection was lost after refresh",
  );
  await page
    .getByLabel("Move selected commands to")
    .selectOption("bedroom||fan");
  await page.getByRole("button", { name: "Move 5", exact: true }).click();
  await page.getByText("Moved 5 commands to Fan.", { exact: true }).waitFor();
  const bulkMoveCalls = (
    await page.evaluate(() => window.__IMPRINT_REFINERY_FIXTURES__.calls)
  ).filter((call) => (call.action || call.service) === "move_command");
  assert.equal(
    bulkMoveCalls.length,
    5,
    "bulk organization did not move every selected command",
  );
  assert(
    bulkMoveCalls.every(
      (call) =>
        (call.data?.target_location_id ||
          call.service_data?.target_location_id) === "bedroom" &&
        (call.data?.target_appliance_id ||
          call.service_data?.target_appliance_id) === "fan",
    ),
    "bulk organization did not preserve the chosen destination appliance",
  );

  await open("library", { width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Learn command" }).click();
  await page.getByText("Command captured", { exact: true }).waitFor();
  const learnDialog = page.getByRole("dialog", { name: "Command captured" });
  const learnClose = learnDialog.getByRole("button", {
    name: "Cancel capture",
    exact: true,
  });
  assert.equal(
    await learnDialog.getAttribute("aria-modal"),
    "true",
    "Learn review did not expose modal semantics",
  );
  assert.equal(
    await page.locator("imprint-library-inspector").getAttribute("inert"),
    "",
    "Learn flow did not make the covered Library inert",
  );
  assert.equal(
    await page.locator("imprint-library-inspector").getAttribute("aria-hidden"),
    "true",
    "Learn flow did not hide the covered Library from assistive technology",
  );
  assert.equal(
    await learnClose.evaluate(
      (element) => element.getRootNode().activeElement === element,
    ),
    true,
    "Learn review did not move focus into the dialog",
  );
  await learnClose.press("Shift+Tab");
  await page.keyboard.press("Tab");
  assert.equal(
    await learnClose.evaluate(
      (element) => element.getRootNode().activeElement === element,
    ),
    true,
    "Learn dialog focus did not wrap at its boundary",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Cancel capture", exact: true })
      .getAttribute("title"),
    "Cancel capture",
    "Captured-command close control had no visible tooltip",
  );
  assert.equal(
    await page.getByLabel("Command name", { exact: true }).inputValue(),
    "",
    "Learn review inserted prompt copy as a field value",
  );
  assert.equal(
    await page
      .getByLabel("Command name", { exact: true })
      .getAttribute("placeholder"),
    "Power",
    "Learn review did not expose a real command-name placeholder",
  );
  await page.getByLabel("Command name", { exact: true }).fill("Fixture power");
  assert.equal(
    await page
      .locator("imprint-learn-flow label.field", {
        hasText: "Appliance (optional)",
      })
      .locator("select")
      .isVisible(),
    true,
  );
  await page.getByText("Technical details", { exact: true }).click();
  await page
    .locator("imprint-learn-flow label.field", {
      hasText: "Home Assistant shortcut (optional)",
    })
    .locator("select")
    .selectOption("");
  await page.getByRole("button", { name: "Test once" }).click();
  await page.getByRole("button", { name: "Save command" }).click();
  await page.getByText("Saved Fixture power.", { exact: true }).waitFor();
  assert.equal(
    await page.locator("imprint-library-inspector").getAttribute("inert"),
    null,
    "Library stayed inert after Learn closed",
  );
  const learnTrigger = page.getByRole("button", { name: "Learn command" });
  await learnTrigger.click();
  await page.getByRole("dialog", { name: "Command captured" }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      !document
        .querySelector("imprint-refinery-card")
        ?.shadowRoot?.querySelector("imprint-learn-flow"),
  );
  await page.waitForFunction(() => {
    const inspector = document
      .querySelector("imprint-refinery-card")
      ?.shadowRoot?.querySelector("imprint-library-inspector");
    const picker = inspector?.shadowRoot?.querySelector(
      "imprint-emitter-picker",
    );
    const trigger = picker?.shadowRoot?.querySelector("button");
    return Boolean(trigger && trigger.getRootNode().activeElement === trigger);
  });
  assert.equal(
    await learnTrigger.evaluate(
      (element) => element.getRootNode().activeElement === element,
    ),
    true,
    "Learn flow did not return focus to its opener after Escape",
  );
  observedCalls.push(
    ...(await page.evaluate(() => window.__IMPRINT_REFINERY_FIXTURES__.calls)),
  );

  await open("library");
  await page.getByRole("button", { name: "Find codes" }).click();
  await page.getByRole("button", { name: "Find by brand or model" }).click();
  await page.getByLabel("Brand").fill("Vizio");
  await page.getByRole("button", { name: "Search codes" }).click();
  await page.getByText("Vizio Common TV family", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByText("4 selected", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Import starter" }).click();
  await page.getByText("Imported 4 commands.", { exact: true }).waitFor();
  observedCalls.push(
    ...(await page.evaluate(() => window.__IMPRINT_REFINERY_FIXTURES__.calls)),
  );

  await open("library");
  await page.getByRole("button", { name: "Find codes" }).click();
  await page.getByRole("button", { name: "Find by brand or model" }).click();
  await page.getByLabel("Brand").fill("Vizio");
  await page.getByRole("button", { name: "Search codes" }).click();
  await page.getByRole("button", { name: "Test this remote" }).click();
  await page.getByText("Make sure the TV is on", { exact: true }).waitFor();
  await page.locator("imprint-catalog-guided button.primary.wide").click();
  await page.getByRole("button", { name: "It worked" }).click();
  await page
    .getByText("Your appliance responded to this code", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Review and import commands" })
    .click();
  observedCalls.push(
    ...(await page.evaluate(() => window.__IMPRINT_REFINERY_FIXTURES__.calls)),
  );

  await open("library-unassigned", { width: 1024, height: 900 });
  await page.getByText("Unassigned commands", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Unsorted remote", { exact: true }).count(),
    0,
    "synthetic appliance leaked into the UI",
  );
  assert.equal(
    await page.getByText("/ Unsorted", { exact: true }).count(),
    0,
    "synthetic location leaked into the UI",
  );
  const searchBox = await page
    .locator("imprint-library-browser .search")
    .boundingBox();
  const filtersBox = await page
    .locator("imprint-library-browser .filters")
    .boundingBox();
  assert.equal(
    boxesOverlap(searchBox, filtersBox),
    false,
    "library search and filters overlap",
  );
  const sendButtonBox = await page
    .getByRole("button", { name: "Send Lamp on once" })
    .boundingBox();
  const overflowButtonBox = await page
    .getByRole("button", { name: "Actions for Lamp on" })
    .boundingBox();
  assert(
    sendButtonBox && overflowButtonBox,
    "command card action controls did not render",
  );
  assert(
    Math.abs(sendButtonBox.width - sendButtonBox.height) <= 1,
    `Send once control was not 1:1: ${JSON.stringify(sendButtonBox)}`,
  );
  assert(
    Math.abs(sendButtonBox.width - overflowButtonBox.width) <= 1 &&
      Math.abs(sendButtonBox.height - overflowButtonBox.height) <= 1,
    `command card action controls did not share a footprint: ${JSON.stringify({ sendButtonBox, overflowButtonBox })}`,
  );
  const commandCard = page
    .getByRole("button", { name: "Send Lamp on once" })
    .locator("xpath=..");
  const commandCardBeforeSend = await commandCard.boundingBox();
  await page.getByRole("button", { name: "Send Lamp on once" }).click();
  await page
    .locator(
      'imprint-library-browser button.send.success ha-icon[icon="mdi:check"]',
    )
    .waitFor({ state: "attached" });
  const commandCardAfterSend = await commandCard.boundingBox();
  assert(
    commandCardBeforeSend && commandCardAfterSend,
    "command card disappeared after Send once",
  );
  assert(
    Math.abs(commandCardBeforeSend.y - commandCardAfterSend.y) <= 0.5 &&
      Math.abs(commandCardBeforeSend.height - commandCardAfterSend.height) <=
        0.5,
    `Send feedback changed command-card geometry: ${JSON.stringify({ commandCardBeforeSend, commandCardAfterSend })}`,
  );
  assert.equal(
    await page.locator("imprint-library-browser .send-result").count(),
    0,
    "Send once rendered a layout-shifting feedback row",
  );
  assert.notEqual(
    await page
      .getByRole("button", { name: "Send Lamp on once" })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "successful Send once did not color the control",
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector("imprint-refinery-card")
        ?.shadowRoot?.querySelector("imprint-library-inspector")
        ?.shadowRoot?.querySelector("imprint-library-browser")
        ?.shadowRoot?.querySelector("button.send ha-icon")
        ?.getAttribute("icon") === "mdi:send",
  );
  assert.equal(
    await page.locator("imprint-library-browser button.send.success").count(),
    0,
    "successful Send once did not reset after one second",
  );
  await page.getByRole("button", { name: "Actions for Lamp on" }).click();
  await page.waitForTimeout(50);
  const menuTriggerBox = await page
    .getByRole("button", { name: "Actions for Lamp on" })
    .boundingBox();
  const menuBox = await page
    .locator("imprint-library-browser details.menu[open] .menu-popover")
    .boundingBox();
  assert(
    menuBox &&
      menuBox.x >= 0 &&
      menuBox.y >= 0 &&
      menuBox.x + menuBox.width <= 1024 &&
      menuBox.y + menuBox.height <= 900,
    `command menu escaped the viewport: ${JSON.stringify(menuBox)}`,
  );
  assert(
    menuTriggerBox &&
      Math.min(
        Math.abs(menuBox.x - menuTriggerBox.x),
        Math.abs(
          menuBox.x + menuBox.width - (menuTriggerBox.x + menuTriggerBox.width),
        ),
      ) <= 12,
    `command menu detached horizontally from its trigger: ${JSON.stringify({ menuBox, menuTriggerBox })}`,
  );
  assert(
    Math.abs(menuBox.y - (menuTriggerBox.y + menuTriggerBox.height)) <= 12 ||
      Math.abs(menuBox.y + menuBox.height - menuTriggerBox.y) <= 12,
    "command menu detached vertically from its trigger",
  );
  const commandCardBeforeCopy = await commandCard.boundingBox();
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  await page
    .locator(
      'imprint-library-browser summary.action-success ha-icon[icon="mdi:check"]',
    )
    .waitFor({ state: "attached" });
  const commandCardAfterCopy = await commandCard.boundingBox();
  assert(
    commandCardBeforeCopy &&
      commandCardAfterCopy &&
      Math.abs(commandCardBeforeCopy.height - commandCardAfterCopy.height) <=
        0.5,
    "Copy feedback changed command-card geometry",
  );
  await page.getByRole("button", { name: "Actions for Lamp on" }).click();
  await page.getByRole("button", { name: "Choose icon", exact: true }).click();
  const iconDialog = page.getByRole("dialog", {
    name: "Edit icon for Lamp on",
  });
  await iconDialog.waitFor();
  const iconEditor = page.locator("imprint-library-browser .icon-editor");
  assert.equal(
    (
      await iconEditor.locator(".icon-preview-copy small").textContent()
    )?.trim(),
    "mdi:power",
    "icon editor did not preview the stored per-command icon",
  );
  await iconEditor.getByLabel("Home Assistant icon").fill("mdi:fan");
  assert.equal(
    await iconEditor.locator(".icon-preview > ha-icon").getAttribute("icon"),
    "mdi:fan",
    "icon preview did not update with the selected icon",
  );
  await iconEditor
    .getByRole("button", { name: "Use default", exact: true })
    .click();
  assert.equal(
    await iconEditor.locator(".icon-preview > ha-icon").getAttribute("icon"),
    "mdi:remote",
    "default reset did not restore the remote icon preview",
  );
  await iconEditor.getByLabel("Home Assistant icon").fill("mdi:fan");
  await page
    .locator("imprint-library-browser .dialog-actions")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const iconCalls = await page.evaluate(
    () => window.__IMPRINT_REFINERY_FIXTURES__.calls,
  );
  const iconUpdate = iconCalls.find(
    (call) =>
      (call.action || call.service) === "update_command" &&
      (call.service_data?.icon || call.data?.icon) === "mdi:fan",
  );
  assert(
    iconUpdate,
    `per-command icon selection did not reach update_command: ${JSON.stringify(iconCalls.slice(-5))}`,
  );
  await assertNoHorizontalOverflow("1024px one-command library");

  await open("inspector-ambiguous", { width: 1024, height: 900 });
  assert.equal(
    await page.getByText("Unsorted remote", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByText("ambiguous protocol candidates", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByText("ambiguous repeat semantics", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByText("Single Press Optimization", { exact: true }).count(),
    1,
  );
  const remoteAction = page.locator("imprint-command-inspector pre.code");
  const remoteActionYaml = (await remoteAction.textContent()) || "";
  assert.match(
    remoteActionYaml,
    /device_id: fixture-remote/,
    "Imprint action omitted the appliance device",
  );
  assert.match(
    remoteActionYaml,
    /domain: imprint_refinery/,
    "remote command did not use the named Imprint device action",
  );
  assert.match(
    remoteActionYaml,
    /type: send_saved_command/,
    "Imprint action omitted its action type",
  );
  assert.match(
    remoteActionYaml,
    /entity_id: remote\.unsorted_remote/,
    "Imprint action targeted the command button instead of the appliance remote",
  );
  assert.match(
    remoteActionYaml,
    /command_id: "lamp_on"/,
    "Imprint action omitted the saved command ID",
  );
  assert.match(
    remoteActionYaml,
    /num_repeats: 1/,
    "Imprint action did not expose the send count",
  );
  assert.match(
    remoteActionYaml,
    /delay_secs: 0\.4/,
    "Imprint action did not expose the inter-repeat delay",
  );
  assert.doesNotMatch(
    remoteActionYaml,
    /remote\.send_command|button\.press|homeassistant\.turn_on|hold_secs/,
    "Inspector retained the generic automation editor fields",
  );
  await page.getByRole("tab", { name: "Signal" }).click();
  await page.getByRole("button", { name: "Open in Signal Lab" }).waitFor();
  await assertNoHorizontalOverflow("ambiguous Inspector");

  await open("inspector-single-frame", { width: 1024, height: 900 });
  const capturedRepeats = page.locator("imprint-command-inspector .metric", {
    hasText: "Captured repeats",
  });
  const requiredRepeats = page.locator("imprint-command-inspector .metric", {
    hasText: "Required repeats",
  });
  assert.equal(
    (await capturedRepeats.locator("strong").textContent())?.trim(),
    "0",
    "a single NEC frame was not reported as zero captured repeats",
  );
  assert.equal(
    (await requiredRepeats.locator("strong").textContent())?.trim(),
    "None",
    "NEC incorrectly claimed that a one-press command requires repeats",
  );
  assert.match(
    (await requiredRepeats.locator("small").textContent()) || "",
    /No repeats are required for one press/,
    "the required-repeat explanation did not distinguish one-press behavior from hold behavior",
  );
  await assertNoHorizontalOverflow("single-frame Inspector");

  await open("lab", { width: 1024, height: 900 });
  const smoothingLab = page.locator("imprint-signal-lab");
  assert.equal(
    await smoothingLab
      .getByRole("button", { name: "Normalize", exact: true })
      .count(),
    0,
    "legacy Normalize action remained visible",
  );
  assert.equal(
    await smoothingLab.getByText("Known protocol", { exact: true }).count(),
    0,
    "disabled protocol-generation choice remained visible",
  );
  await smoothingLab
    .getByRole("button", { name: "Preview smoothing", exact: true })
    .click();
  const smoothingDialog = page.getByRole("dialog", {
    name: "Smooth timing jitter",
  });
  await smoothingDialog.waitFor();
  assert.match(
    (await smoothingDialog.textContent()) || "",
    /Protocol rules were not used/i,
    "smoothing preview did not disclose its measured-data basis",
  );
  assert.match(
    (await page
      .locator("imprint-signal-lab .preview-metrics .metric", {
        hasText: "Timing basis",
      })
      .textContent()) || "",
    /Current-draft averages/,
    "smoothing preview did not name its timing basis",
  );
  const smoothingOriginal = await smoothingLab.evaluate((element) => [
    ...element.lab.original,
  ]);
  await page
    .getByRole("button", { name: "Apply smoothed timings", exact: true })
    .click();
  const smoothedState = await smoothingLab.evaluate((element) => ({
    original: element.lab.original,
    timings: element.lab.timings,
    dirty: element.lab.dirty,
  }));
  assert.deepEqual(
    smoothedState.original,
    smoothingOriginal,
    "smoothing changed the protected source signal",
  );
  assert.notDeepEqual(
    smoothedState.timings,
    smoothingOriginal,
    "smoothing did not change the jittered draft",
  );
  assert.equal(
    smoothedState.dirty,
    true,
    "smoothing did not keep the result as an editable draft",
  );

  await open("lab-rebuildable-sirc", { width: 1024, height: 900 });
  const rebuildLab = page.locator("imprint-signal-lab");
  await rebuildLab
    .getByRole("button", { name: "Preview SIRC rebuild", exact: true })
    .click();
  const rebuildDialog = page.getByRole("dialog", { name: "Rebuild as SIRC" });
  await rebuildDialog.waitFor();
  assert.match(
    (await rebuildDialog.textContent()) || "",
    /SIRC protocol definition/i,
    "protocol rebuild did not disclose its canonical timing source",
  );
  assert.match(
    (await page
      .locator("imprint-signal-lab .preview-metrics .metric", {
        hasText: "Carrier",
      })
      .textContent()) || "",
    /38\.0\s*→\s*40\.0\s+kHz/,
    "protocol rebuild did not preview the canonical carrier change",
  );
  const rebuildSource = await rebuildLab.evaluate((element) => ({
    timings: [...element.lab.original],
    carrier: element.lab.originalCarrierFrequency,
  }));
  await page
    .getByRole("button", { name: "Apply SIRC rebuild", exact: true })
    .click();
  const rebuiltState = await rebuildLab.evaluate((element) => ({
    original: element.lab.original,
    originalCarrier: element.lab.originalCarrierFrequency,
    timings: element.lab.timings,
    carrier: element.lab.carrierFrequency,
    roles: element.lab.frameRoles,
    dirty: element.lab.dirty,
  }));
  assert.deepEqual(
    rebuiltState.original,
    rebuildSource.timings,
    "protocol rebuild changed the protected source timings",
  );
  assert.equal(
    rebuiltState.originalCarrier,
    rebuildSource.carrier,
    "protocol rebuild changed the protected source carrier",
  );
  assert.equal(
    rebuiltState.carrier,
    40000,
    "protocol rebuild did not apply the SIRC carrier",
  );
  assert.equal(
    rebuiltState.timings.length,
    rebuildSource.timings.length * 3,
    "protocol rebuild did not add SIRC's required frames",
  );
  assert.deepEqual(
    rebuiltState.roles,
    ["intro", "repeat", "repeat"],
    "protocol rebuild did not apply the rebuilt frame roles",
  );
  assert.equal(
    rebuiltState.dirty,
    true,
    "protocol rebuild did not keep the result as an editable draft",
  );

  await open("lab-repeats", { width: 1024, height: 900 });
  assert.equal(
    await page
      .getByText(
        "The signal ends on a mark; review mark/space parity before sending.",
        { exact: true },
      )
      .count(),
    0,
    "valid mark-ending signal showed a non-actionable warning",
  );
  const labActionBar = page.locator("imprint-signal-lab .action-bar");
  const liveEmitterLabel = (
    await labActionBar.locator(".availability strong").textContent()
  )?.trim();
  assert(
    liveEmitterLabel &&
      !["Emitter ready", "Emitter offline"].includes(liveEmitterLabel),
    "Signal Lab action bar did not show the selected emitter name",
  );
  assert.equal(
    await labActionBar
      .locator('.availability > ha-icon[icon="mdi:remote"]')
      .count(),
    1,
    "Signal Lab action bar did not use the approved emitter icon",
  );
  assert.equal(
    await labActionBar
      .getByRole("button", { name: "Save as new command", exact: true })
      .count(),
    1,
    "Signal Lab action bar shortened the approved save label",
  );
  assert.equal(
    await labActionBar
      .getByText("Original is protected", { exact: true })
      .count(),
    1,
    "Signal Lab action bar shortened the approved protection label",
  );
  assert.equal(
    await page
      .getByRole("tab", { name: "Timings", exact: true })
      .getAttribute("aria-selected"),
    "true",
    "approved Timings workbench was not the default Signal Lab view",
  );
  assert.equal(
    await page.getByRole("tab", { name: "Decoded", exact: true }).count(),
    1,
    "Decoded workbench tab missing",
  );
  assert.equal(
    await page.getByRole("tab", { name: "Encoded code", exact: true }).count(),
    1,
    "Encoded code workbench tab missing",
  );
  await page.getByRole("tab", { name: "Decoded", exact: true }).click();
  assert.equal(
    (
      await page
        .getByLabel("Binary payload in transmission order")
        .textContent()
    )?.trim(),
    "00001000 11110111 00000100 11111011",
    "Decoded workbench did not expose the recognized transmission-order bits",
  );
  assert.equal(
    await page
      .getByText("100% support · 4/4 decoders agree", { exact: true })
      .count(),
    1,
    "Auto did not report exact agreement from every applicable decoder",
  );
  assert.match(
    (await page.locator("imprint-signal-lab .binary-note").textContent()) || "",
    /least-significant bit first/i,
    "binary payload did not disclose bit order",
  );
  assert.equal(
    await page.getByRole("button", { name: "Copy bits", exact: true }).count(),
    1,
    "raw bitstream was not copyable",
  );
  await page
    .locator("imprint-signal-lab label.field", { hasText: "Bitstream decoder" })
    .locator("select")
    .selectOption("pulse_width");
  assert.equal(
    await page.getByLabel("Binary payload in transmission order").count(),
    0,
    "a rejected manual decoder fabricated a bitstream",
  );
  assert.match(
    (await page.locator("imprint-signal-lab .notice.warning").textContent()) ||
      "",
    /requires two mark-duration classes/i,
    "manual decoder rejection was not explained",
  );
  await page
    .locator("imprint-signal-lab label.field", { hasText: "Bitstream decoder" })
    .locator("select")
    .selectOption("protocol");
  assert.equal(
    (
      await page
        .getByLabel("Binary payload in transmission order")
        .textContent()
    )?.trim(),
    "00001000 11110111 00000100 11111011",
    "named protocol decoding disagreed with the accepted Auto bitstream",
  );
  await page
    .locator("imprint-signal-lab label.field", { hasText: "Bitstream decoder" })
    .locator("select")
    .selectOption("auto");
  assert.equal(
    await page
      .getByText("Protocol interpretations (3)", { exact: true })
      .count(),
    1,
    "protocol semantics were not collapsed",
  );
  assert.equal(
    await page
      .locator("imprint-signal-lab details.alternatives")
      .getAttribute("open"),
    null,
    "alternate protocol semantics opened by default",
  );
  await page.getByText("Protocol interpretations (3)", { exact: true }).click();
  assert.match(
    (await page
      .locator("imprint-signal-lab .candidate-facts")
      .first()
      .textContent()) || "",
    /0x0C/,
    "single-digit decoded hex was not padded to a complete byte",
  );
  await page.getByRole("tab", { name: "Encoded code", exact: true }).click();
  const encodedCode = page.getByLabel("Pronto Hex code", { exact: true });
  await encodedCode.waitFor();
  assert.match(
    await encodedCode.inputValue(),
    /^0000 006D /,
    "Encoded code tab did not render the selected representation inline",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Copy code", exact: true })
      .isEnabled(),
    true,
    "visible encoded code could not be copied",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Inspect encoded code", exact: true })
      .count(),
    0,
    "legacy conversion launcher remained in the Encoded code tab",
  );
  await page
    .locator("imprint-signal-lab .code-toolbar select")
    .selectOption("girr");
  const girrCode = page.getByLabel("GIRR 1.2 code", { exact: true });
  await girrCode.waitFor();
  assert.match(
    await girrCode.inputValue(),
    /^<girr:remote /,
    "changing representation did not refresh the visible encoded code",
  );
  await page.getByRole("tab", { name: "Timings", exact: true }).click();
  assert.equal(
    await page.getByText("Save experiment", { exact: true }).count(),
    0,
    "legacy page-level save panel remained visible",
  );
  assert.equal(
    await page.getByText("Live validation", { exact: true }).count(),
    0,
    "legacy page-level validation panel remained visible",
  );
  await labActionBar
    .getByRole("button", { name: "Save as new command", exact: true })
    .click();
  const saveDialog = page.getByRole("dialog", { name: "Save as new command" });
  await saveDialog.waitFor();
  assert.equal(
    await page
      .locator("imprint-signal-lab .save-dialog")
      .getByLabel("Name", { exact: true })
      .count(),
    1,
    "focused save dialog did not expose the command name",
  );
  await saveDialog.getByRole("button", { name: "Close" }).click();
  const labelBoxes = await page
    .locator("imprint-signal-waveform .frame span")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.parentElement.getBoundingClientRect();
        return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom };
      }),
    );
  for (let index = 1; index < labelBoxes.length; index++) {
    assert(
      labelBoxes[index - 1].right <= labelBoxes[index].x ||
        labelBoxes[index - 1].bottom <= labelBoxes[index].y,
      "frame annotations overlap",
    );
  }
  const wave = page.locator('imprint-signal-waveform svg[data-track="draft"]');
  const renderedWave = await wave.evaluate((svg) => {
    const path = svg.querySelector("path.wave");
    if (!path) return { namespace: "", width: 0, height: 0 };
    const box = path.getBBox();
    return {
      namespace: path.namespaceURI,
      width: box.width,
      height: box.height,
    };
  });
  assert.equal(
    renderedWave.namespace,
    "http://www.w3.org/2000/svg",
    "editable waveform path was not created in the SVG namespace",
  );
  assert(
    renderedWave.width > 0 && renderedWave.height > 0,
    "editable waveform path did not render visibly",
  );
  const beforeGutter = page.locator(
    'imprint-signal-waveform .track.draft > [data-signal-gutter="before"]',
  );
  const afterGutter = page.locator(
    'imprint-signal-waveform .track.draft > [data-signal-gutter="after"]',
  );
  await beforeGutter.getByText("Before signal", { exact: true }).waitFor();
  await afterGutter.getByText("After signal", { exact: true }).waitFor();
  const [beforeBox, plotBox, afterBox] = await Promise.all([
    beforeGutter.boundingBox(),
    wave.boundingBox(),
    afterGutter.boundingBox(),
  ]);
  assert(
    beforeBox && plotBox && afterBox,
    "signal boundary gutters did not render",
  );
  assert(
    Math.abs(beforeBox.x + beforeBox.width - plotBox.x) <= 2,
    "pre-signal gutter did not meet the 0 µs edge",
  );
  assert(
    Math.abs(plotBox.x + plotBox.width - afterBox.x) <= 2,
    "post-signal gutter did not meet the signal end",
  );
  const startEdge = page.locator(
    'imprint-signal-waveform .track.draft [data-signal-edge="start"]',
  );
  assert(await startEdge.count(), "0 µs rising edge was not drawn");
  const startEdgeHeight = await startEdge.evaluate(
    (edge) => edge.getBBox().height,
  );
  assert(startEdgeHeight > 0, "0 µs rising edge was not visible");
  assert.equal(
    await page.locator("imprint-signal-waveform .y-axis .mark").count(),
    1,
    "Mark axis label missing",
  );
  assert.equal(
    await page.locator("imprint-signal-waveform .y-axis .space").count(),
    1,
    "Space axis label missing",
  );
  assert(
    (await page.locator("imprint-signal-waveform .ruler-tick").count()) >= 3,
    "elapsed-time axis did not render useful tick labels",
  );
  await wave.scrollIntoViewIfNeeded();
  const waveBox = await wave.boundingBox();
  assert(waveBox, "waveform bounds unavailable for hover acceptance");
  await wave.hover({
    position: { x: waveBox.width * 0.2, y: waveBox.height * 0.55 },
  });
  const hoverProbe = page.locator("imprint-signal-waveform [data-hover-probe]");
  await hoverProbe.waitFor();
  assert.match(
    (await hoverProbe.textContent()) || "",
    /(?:µs|ms)\s*·\s*(?:mark|space)/,
    "waveform hover probe did not expose duration and signal level",
  );
  assert.equal(
    await page.locator("imprint-signal-waveform .minimap").count(),
    0,
    "minimap duplicated the waveform at Fit/1×",
  );
  const beforeSpan = Number(await wave.getAttribute("data-view-span"));
  await page.getByRole("button", { name: "Zoom in" }).click();
  const afterSpan = Number(await wave.getAttribute("data-view-span"));
  assert(
    afterSpan < beforeSpan,
    "zoom did not change the waveform time window",
  );
  assert.equal(
    await page
      .locator('imprint-signal-waveform .minimap [data-signal-gutter="before"]')
      .count(),
    1,
    "zoomed minimap pre-signal gutter missing",
  );
  assert.equal(
    await page
      .locator('imprint-signal-waveform .minimap [data-signal-gutter="after"]')
      .count(),
    1,
    "zoomed minimap post-signal gutter missing",
  );
  await page.getByRole("button", { name: /Fit ·/ }).click();
  assert.equal(
    Number(await wave.getAttribute("data-view-span")),
    beforeSpan,
    "Fit did not restore the complete signal",
  );
  assert.equal(
    await beforeGutter.count(),
    1,
    "Fit did not restore the pre-signal gutter",
  );
  assert.equal(
    await afterGutter.count(),
    1,
    "Fit did not restore the post-signal gutter",
  );
  assert.equal(
    await page.locator("imprint-signal-waveform .minimap").count(),
    0,
    "Fit did not hide the redundant minimap",
  );
  await page.getByRole("button", { name: "Preview optimization" }).click();
  await page
    .getByRole("dialog")
    .getByText("Optimize for one press", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Apply to experiment" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Reset", exact: true }).isEnabled(),
    true,
    "applied optimization did not mark the experiment as editable",
  );
  assert.equal(
    await page.getByText("Optimize for one press", { exact: true }).count(),
    0,
    "non-actionable one-press optimization remained visible",
  );
  await assertNoHorizontalOverflow("Signal Lab repeat workflow");

  await open("lab-invalid", { width: 1024, height: 900 });
  assert.equal(
    await page.getByText("Optimize for one press", { exact: true }).count(),
    0,
    "Signal Lab rendered a dead optimization card without a safe candidate",
  );

  await open("lab-custom", { width: 1024, height: 900 });
  await page
    .getByRole("button", { name: "Save as new command", exact: true })
    .click();
  const customSaveDialog = page.getByRole("dialog", {
    name: "Save as new command",
  });
  await customSaveDialog.waitFor();
  const customSaveSurface = page.locator("imprint-signal-lab .save-dialog");
  const customSaveName = customSaveSurface.getByLabel("Name", { exact: true });
  assert.equal(
    await customSaveName.inputValue(),
    "",
    "Custom Signal Lab inserted prompt copy as a command name",
  );
  assert.equal(
    await customSaveName.getAttribute("placeholder"),
    "e.g. Reading light",
    "Custom Signal Lab did not expose a real name placeholder",
  );
  assert.equal(
    await customSaveSurface
      .locator('input[placeholder="reading_light"]')
      .inputValue(),
    "",
    "Custom Signal Lab inserted a fake command ID",
  );
  await customSaveDialog.getByRole("button", { name: "Close" }).click();

  await open("lab-inferred-binary", { width: 1024, height: 900 });
  assert.equal(
    (
      await page
        .getByLabel("Binary payload in transmission order")
        .textContent()
    )?.trim(),
    "01011010",
    "structurally inferred binary payload was not shown",
  );
  assert.equal(
    await page
      .getByText("70% support · one applicable decoder", { exact: true })
      .count(),
    1,
    "single-decoder binary inference did not carry a lower support score",
  );
  assert.match(
    (await page.locator("imprint-signal-lab .binary-note").textContent()) || "",
    /protocol, bit order, and field meanings are unknown/i,
    "structural binary inference did not disclose its semantic limits",
  );

  await open("inspector-code", { width: 1024, height: 900 });
  await page.getByText("Raw bitstream", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText("Protocol interpretations (3)", { exact: true })
      .count(),
    1,
    "Inspector did not collapse protocol semantics",
  );
  assert.equal(
    await page
      .locator("imprint-command-inspector details.alternatives")
      .getAttribute("open"),
    null,
    "Inspector opened alternate decoder semantics by default",
  );
  assert.equal(
    await page.getByText(/bits 32 · 0x20/i).count(),
    0,
    "Inspector formatted frame length as decoded data",
  );

  await open("lab-code", { width: 1024, height: 900 });
  const paddedPronto = page.getByLabel("Pronto Hex code", { exact: true });
  await paddedPronto.waitFor();
  assert.match(
    await paddedPronto.inputValue(),
    /^0000 006D /,
    "open-ended capture did not render a padded Pronto representation",
  );
  assert.equal(
    await page.getByText("Trailing idle encoded", { exact: true }).count(),
    1,
    "Pronto padding was not disclosed beside the visible code",
  );
  assert.match(
    (await page
      .locator("imprint-signal-lab .code-surface .notice")
      .textContent()) || "",
    /saved capture remains unchanged/i,
    "Pronto padding disclosure did not protect the measured source",
  );
  await assertNoHorizontalOverflow("open-ended Pronto code viewer");

  await open("catalog-import-preview", { width: 1024, height: 900 });
  assert.match(
    (await page.getByLabel("Remote data").getAttribute("placeholder")) || "",
    /Paste Pronto/,
    "Import prompt was not a real textarea placeholder",
  );

  await open("lab-repeats", { width: 390, height: 844 });
  const mobileLabBar = page.locator("imprint-signal-lab .action-bar");
  assert.equal(
    await mobileLabBar.evaluate(
      (element) => getComputedStyle(element).position,
    ),
    "sticky",
    "Signal Lab actions were not sticky on phones",
  );
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(50);
  const mobileLabBarBox = await mobileLabBar.boundingBox();
  assert(
    mobileLabBarBox && mobileLabBarBox.y <= 1,
    `Signal Lab actions scrolled out of reach: ${JSON.stringify(mobileLabBarBox)}`,
  );
  assert.equal(
    await mobileLabBar
      .getByRole("button", { name: "Test once", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await mobileLabBar
      .getByRole("button", { name: "Save as new command", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Previous timing", exact: true })
      .getAttribute("title"),
    "Previous timing",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Next timing", exact: true })
      .getAttribute("title"),
    "Next timing",
  );

  await open("library", { width: 720, height: 900 });
  await assertNoHorizontalOverflow("Library at 200% desktop-equivalent zoom");

  for (const view of [
    "empty",
    "offline",
    "no-blaster",
    "load-error",
    "learn-error",
    "inspector-malformed",
    "lab-invalid",
    "catalog-error",
  ]) {
    await open(view, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(`${view} mobile`);
  }
  await open("load-error", { width: 390, height: 844 });
  const dismissError = page.getByRole("button", {
    name: "Dismiss error notification",
    exact: true,
  });
  await dismissError.waitFor();
  const dismissBox = await dismissError.boundingBox();
  assert(
    dismissBox && dismissBox.width >= 44 && dismissBox.height >= 44,
    `Error dismissal touch target was too small: ${JSON.stringify(dismissBox)}`,
  );
  await dismissError.click();
  assert.equal(
    await dismissError.count(),
    0,
    "Persistent global error could not be dismissed",
  );
  for (const view of [
    "library",
    "learn-review",
    "inspector-signal",
    "inspector-single-frame",
    "lab-repeats",
    "catalog-import-preview",
    "guided",
  ]) {
    await open(view, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(`${view} mobile`);
  }
  await open("library", { width: 390, height: 844 });
  const rememberedScroll = await page.evaluate(() => {
    window.scrollTo(
      0,
      Math.min(420, document.documentElement.scrollHeight - innerHeight),
    );
    return window.scrollY;
  });
  assert(
    rememberedScroll > 0,
    "Mobile Library fixture was not tall enough to test scroll restoration",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await page.waitForFunction(
    (expected) => Math.abs(window.scrollY - Number(expected)) <= 2,
    rememberedScroll,
  );
  const mobilePower = page
    .locator("imprint-library-browser .command-open", { hasText: "Power" })
    .first();
  await mobilePower.click();
  const mobileInspectorClose = page.getByRole("button", {
    name: "Close command details",
  });
  await mobileInspectorClose.waitFor();
  await page.waitForFunction(() => {
    const host = document
      .querySelector("imprint-refinery-card")
      ?.shadowRoot?.querySelector("imprint-library-inspector");
    const close = host?.shadowRoot?.querySelector(".inspector-close");
    return Boolean(close && close.getRootNode().activeElement === close);
  });
  assert.equal(
    await mobileInspectorClose.evaluate(
      (element) => element.getRootNode().activeElement === element,
    ),
    true,
    "Mobile Inspector did not focus its close control",
  );
  assert.equal(
    await page
      .locator("imprint-library-inspector aside.inspector")
      .getAttribute("role"),
    "dialog",
    "Mobile Inspector did not expose modal dialog semantics",
  );
  assert.equal(
    await page
      .locator("imprint-library-inspector aside.inspector")
      .getAttribute("aria-modal"),
    "true",
    "Mobile Inspector did not expose aria-modal",
  );
  assert.equal(
    await page
      .locator("imprint-library-inspector section.library")
      .getAttribute("inert"),
    "",
    "Mobile Inspector did not make its covered Library inert",
  );
  await mobileInspectorClose.press("Shift+Tab");
  assert.equal(
    await mobileInspectorClose.evaluate(
      (element) => element.getRootNode().activeElement === element,
    ),
    false,
    "Mobile Inspector focus trap did not reach its last control",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await mobileInspectorClose.evaluate(
      (element) => element.getRootNode().activeElement === element,
    ),
    true,
    "Mobile Inspector focus escaped instead of wrapping to Close",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await mobileInspectorClose.count(),
    0,
    "Escape did not close the mobile Inspector",
  );
  await page.waitForFunction(() => {
    const browser = document
      .querySelector("imprint-refinery-card")
      ?.shadowRoot?.querySelector("imprint-library-inspector")
      ?.shadowRoot?.querySelector("imprint-library-browser");
    const command = browser?.shadowRoot?.querySelector(".command-open");
    return Boolean(command && command.getRootNode().activeElement === command);
  });
  assert.equal(
    await mobilePower.evaluate(
      (element) => element.getRootNode().activeElement === element,
    ),
    true,
    "Closing the Inspector did not return focus to its command",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement)
        active = active.shadowRoot.activeElement;
      return (
        active instanceof HTMLElement &&
        ["BUTTON", "INPUT", "SELECT", "A"].includes(active.tagName)
      );
    }),
    true,
    "keyboard focus did not enter an interactive control",
  );

  const routePage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  routePage.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push(`route: ${message.text()}`);
  });
  routePage.on("pageerror", (error) =>
    consoleErrors.push(`route: ${error.message}`),
  );
  await routePage.addInitScript(() => {
    if (location.pathname.endsWith("/tools/browser-fixtures/preview.html"))
      history.replaceState({}, "", `/imprint-refinery${location.search}`);
  });
  await routePage.goto(
    `${server.origin}/tools/browser-fixtures/preview.html?view=library&theme=dark`,
    { waitUntil: "networkidle" },
  );
  await routePage.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await routePage.waitForURL(
    (url) =>
      url.pathname === "/imprint-refinery" &&
      url.searchParams.get("screen") === "command",
  );
  await routePage.getByRole("tab", { name: "Signal", exact: true }).click();
  await routePage
    .locator("imprint-command-inspector")
    .getByRole("button", { name: "Zoom in" })
    .click();
  await routePage.waitForURL(
    (url) =>
      url.searchParams.get("tab") === "signal" &&
      url.searchParams.get("zoom") === "2",
  );
  await routePage.getByRole("button", { name: "Open in Signal Lab" }).click();
  await routePage.waitForURL((url) => url.searchParams.get("screen") === "lab");
  await routePage.getByRole("tab", { name: "Decoded", exact: true }).click();
  await routePage
    .locator("imprint-signal-lab label.field", { hasText: "Bitstream decoder" })
    .locator("select")
    .selectOption("pulse_distance");
  await routePage.waitForURL(
    (url) => url.searchParams.get("decoder") === "pulse_distance",
  );
  assert.equal(
    await routePage
      .locator("imprint-refinery-card")
      .evaluate((element) => element.lab?.binaryDecoderMode),
    "pulse_distance",
    "manual bitstream decoder did not reach route state",
  );
  await routePage
    .getByRole("tab", { name: "Encoded code", exact: true })
    .click();
  await routePage
    .locator("imprint-signal-lab .code-toolbar select")
    .selectOption("girr");
  await routePage.waitForURL(
    (url) =>
      url.searchParams.get("lab_tab") === "code" &&
      url.searchParams.get("format") === "girr",
  );
  await routePage.reload({ waitUntil: "networkidle" });
  await routePage.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  assert.equal(
    new URL(routePage.url()).searchParams.get("decoder"),
    "pulse_distance",
    "Signal Lab decoder disappeared from its permalink",
  );
  assert.equal(
    await routePage
      .locator("imprint-refinery-card")
      .evaluate((element) => element.lab?.binaryDecoderMode),
    "pulse_distance",
    "Signal Lab decoder was not restored into route state",
  );
  assert.equal(
    await routePage
      .getByRole("tab", { name: "Encoded code", exact: true })
      .getAttribute("aria-selected"),
    "true",
    "Signal Lab permalink did not restore the active tab",
  );
  assert.equal(
    await routePage
      .locator("imprint-signal-lab .code-toolbar select")
      .inputValue(),
    "girr",
    "Signal Lab permalink did not restore its representation",
  );
  await routePage.getByRole("tab", { name: "Decoded", exact: true }).click();
  assert.equal(
    await routePage
      .locator("imprint-signal-lab")
      .evaluate((element) => element.lab?.binaryDecoderMode),
    "pulse_distance",
    "restored decoder did not reach the Signal Lab component",
  );
  assert.equal(
    await routePage
      .locator("imprint-signal-lab")
      .evaluate((element) => element.binaryMode),
    "pulse_distance",
    "restored decoder did not reach Signal Lab local state",
  );
  await routePage.waitForFunction(() => {
    const card = document.querySelector("imprint-refinery-card");
    const lab = card?.shadowRoot?.querySelector("imprint-signal-lab");
    return (
      lab?.shadowRoot?.querySelector(".decoder-control select")?.value ===
      "pulse_distance"
    );
  });
  assert.equal(
    await routePage
      .locator("imprint-signal-lab label.field", {
        hasText: "Bitstream decoder",
      })
      .locator("select")
      .inputValue(),
    "pulse_distance",
    "Signal Lab permalink did not restore the manual bitstream decoder",
  );
  await routePage
    .getByRole("tab", { name: "Encoded code", exact: true })
    .click();
  await routePage.goBack({ waitUntil: "networkidle" });
  await routePage
    .locator("imprint-command-inspector .head h2", { hasText: "Power" })
    .waitFor();
  assert.equal(
    await routePage
      .getByRole("tab", { name: "Signal", exact: true })
      .getAttribute("aria-selected"),
    "true",
    "Back did not restore the Inspector tab",
  );
  assert.equal(
    await routePage
      .locator("imprint-command-inspector imprint-waveform")
      .evaluate((element) => element.zoom),
    2,
    "Back did not restore Inspector zoom",
  );
  await routePage
    .getByRole("button", { name: "Actions for Power" })
    .first()
    .click();
  await routePage.getByRole("button", { name: "Rename", exact: true }).click();
  await routePage.waitForURL(
    (url) => url.searchParams.get("dialog") === "rename-command",
  );
  await routePage.reload({ waitUntil: "networkidle" });
  await routePage.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await routePage.getByRole("dialog", { name: "Rename command" }).waitFor();
  await routePage.evaluate(() => {
    sessionStorage.removeItem("imprint-refinery.route.learn");
    history.replaceState(
      {},
      "",
      "/imprint-refinery?view=library&theme=dark&screen=learn&location=living_room&appliance=television",
    );
  });
  await routePage.reload({ waitUntil: "networkidle" });
  await routePage.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await routePage
    .getByText(
      "The previous capture screen was not resumed because opening a URL must not start hardware capture.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (
      await routePage.evaluate(() => window.__IMPRINT_REFINERY_FIXTURES__.calls)
    ).some((call) => (call.action || call.service) === "capture_signal"),
    false,
    "a learning permalink restarted hardware capture",
  );
  await routePage.close();

  assert(
    observedCalls.some(
      (call) => (call.action || call.service) === "send_signal",
    ),
    "capture flow did not test a command",
  );
  assert(
    observedCalls.some(
      (call) => (call.action || call.service) === "store_command",
    ),
    "capture flow did not save a command",
  );
  assert(
    observedCalls.some(
      (call) => (call.action || call.service) === "catalog_search",
    ),
    "catalog flow did not search",
  );
  assert(
    observedCalls.some(
      (call) => (call.action || call.service) === "catalog_guided_start",
    ),
    "guided matching did not start",
  );
  assert(
    observedCalls.some(
      (call) => (call.action || call.service) === "catalog_guided_test",
    ),
    "guided matching did not send an explicit test",
  );
  assert(
    observedCalls.some(
      (call) => (call.action || call.service) === "catalog_guided_answer",
    ),
    "guided matching did not record the answer",
  );
  assert(
    observedCalls.some(
      (call) => (call.action || call.service) === "create_appliance",
    ),
    "catalog profile was not imported",
  );
  assert.deepEqual(
    consoleErrors,
    [],
    `browser console errors: ${consoleErrors.join(" | ")}`,
  );
  console.log(
    "Browser acceptance passed: Learn, Library CRUD entry points, atomic Inspector comparison, permalinks, revisions, binary decoding, Signal Lab editing/zoom/repeat optimization, catalog/import/guided matching, error states, mobile geometry, and keyboard focus.",
  );
} finally {
  await browser.close();
  await server.close();
}
