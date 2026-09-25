import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { chromePath, startPreviewServer } from "./preview_server.mjs";

const server = await startPreviewServer();
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

const open = async (view, width = 1440, height = 1000, options = {}) => {
  await page.setViewportSize({ width, height });
  const params = new URLSearchParams({
    view,
    theme: options.theme || "dark",
  });
  if (options.hostWidth) params.set("hostWidth", String(options.hostWidth));
  if (options.textScale) params.set("textScale", String(options.textScale));
  if (options.presentation) params.set("presentation", options.presentation);
  if (options.optionalPicker) params.set("optionalPicker", "1");
  if (options.optionalEmpty) params.set("optionalEmpty", "1");
  if (options.missingTextarea) params.set("missingTextarea", "1");
  await page.goto(
    `${server.origin}/tools/browser-fixtures/preview.html?${params}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await page
    .getByRole("heading", {
      name:
        options.presentation === "card"
      ? "Imprint Refinery"
          : ["empty", "load-error"].includes(view)
            ? "Appliances"
            : "Remote profiles",
    exact: true,
    })
    .waitFor();
};

const openSignalLab = async (view = "lab", width = 1440, height = 1000) => {
  await page.setViewportSize({ width, height });
  await page.goto(
    `${server.origin}/tools/browser-fixtures/preview.html?view=${view}&theme=dark`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await page
    .getByRole("heading", { name: "Signal Lab", exact: true })
    .waitFor();
  return page.locator("imprint-signal-lab");
};

const noOverflow = async (label) =>
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
    `${label} overflowed horizontally`,
  );

const noHostOverflow = async (label) => {
  const measurements = await page.locator("#preview").evaluate((preview) => {
    const card = preview.querySelector("imprint-refinery-card");
    const app = card?.shadowRoot?.querySelector(".app");
    return [preview, card, app].filter(Boolean).map((element) => ({
      name: element.tagName?.toLowerCase?.() || element.className,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
  });
  assert.equal(
    measurements.every(
      ({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 1,
    ),
    true,
    `${label} overflowed its Home Assistant card container: ${JSON.stringify(measurements)}`,
  );
};

const assertFocusContained = async (dialog, label, tabs = 6) => {
  await page.waitForTimeout(30);
  assert.equal(
    await dialog.evaluate((element) => element.matches(":focus-within")),
    true,
    `${label} did not receive focus when opened`,
  );
  for (let index = 0; index < tabs; index += 1) {
    await page.keyboard.press("Tab");
    assert.equal(
      await dialog.evaluate((element) => element.matches(":focus-within")),
      true,
      `${label} allowed focus to escape after ${index + 1} Tab presses`,
    );
  }
};

const assertVisibleIconOnlyControls = async (scope, label) => {
  const controls = scope.locator("ha-icon-button:visible");
  const count = await controls.count();
  assert.ok(count > 0, `${label} exposed no visible icon-only controls`);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    const box = await control.boundingBox();
    assert.ok(
      box && box.width >= 44 && box.height >= 44,
      `${label} icon-only control ${index + 1} measured ${box?.width ?? 0}x${box?.height ?? 0}px`,
    );
    const button = control.getByRole("button");
    assert.equal(
      await button.count(),
      1,
      `${label} icon-only control ${index + 1} did not expose button semantics`,
    );
    assert.ok(
      (await button.getAttribute("aria-label"))?.trim(),
      `${label} icon-only control ${index + 1} had no accessible name`,
    );
  }
};

const infraredIoCounts = async () =>
  page.evaluate(() => {
    const calls = window.__IMPRINT_REFINERY_FIXTURES__.calls;
    const count = (name) =>
      calls.filter((call) => (call.action || call.service) === name).length;
    return {
      sendSignal: count("send_signal"),
      captureSignal: count("capture_signal"),
    };
  });

try {
  await open("library");
  assert.equal(
    await page.evaluate(() =>
      Boolean(customElements.get("imprint-refinery-panel")),
    ),
    true,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      [
        ...(customElements.get("imprint-refinery-card")
          ? [
              "imprint-refinery-card",
              "imprint-refinery-panel",
              "imprint-signal-lab",
              "imprint-signal-waveform",
              "imprint-waveform-comparison",
            ]
          : []),
      ].filter((tag) => Boolean(customElements.get(tag))),
    ),
    [
      "imprint-refinery-card",
      "imprint-refinery-panel",
      "imprint-signal-lab",
      "imprint-signal-waveform",
      "imprint-waveform-comparison",
    ],
    "The frontend should register only its five public element boundaries",
  );
  assert.equal(
    await page
      .locator("imprint-refinery-card")
      .evaluate((card) => card.presentation),
    "panel",
  );
  assert.equal(
    await page.locator("imprint-refinery-card").locator("ha-card").count(),
    0,
  );
  assert.equal(
    await page.evaluate(
      () =>
      (window.customCards || []).filter(
        (card) => card.type === "imprint-refinery-card",
      ).length,
    ),
    1,
    "Imprint Refinery should register one custom card entry",
  );
  const hassUpdate = await page
    .locator("imprint-refinery-card")
    .evaluate(async (card) => {
    await card.updateComplete;
    const current = card.hass;
    const originalPerformUpdate = card.performUpdate;
    let renders = 0;
    card.performUpdate = function (...args) {
      renders += 1;
      return originalPerformUpdate.apply(this, args);
    };
    const replacement = { ...current };
    card.hass = replacement;
    await Promise.resolve();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    card.performUpdate = originalPerformUpdate;
    return {
      renders,
      serviceUpdated: card.services?.hass === replacement,
    };
  });
  assert.equal(
    hassUpdate.renders,
    0,
    "Routine Home Assistant state updates rerendered the whole card",
  );
  assert.equal(
    hassUpdate.serviceUpdated,
    true,
    "Service calls did not receive the latest Home Assistant object",
  );
  await page
    .getByRole("heading", { name: "Silkycasters RGBW", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Used by 2 appliances", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByText(/Changes here affect 2 appliances/).count(),
    1,
  );
  assert.equal(
    await page
      .locator(".profile", { hasText: "Silkycasters RGBW" })
      .getByRole("button", {
      name: "Create appliance from this remote profile",
      exact: true,
      })
      .count(),
    1,
  );
  assert.equal(
    await page.getByText("Active IR emitter", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByText("Manage emitters", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .locator("ha-button", { hasText: "Create custom signal" })
      .locator("ha-icon")
      .getAttribute("icon"),
    "mdi:square-wave",
  );
  const testEmitterBox = await page
    .getByLabel("Test with IR emitter", { exact: true })
    .boundingBox();
  assert.ok(
    testEmitterBox && testEmitterBox.width <= 250,
    "Test emitter selector should remain compact",
  );
  const firstCommand = page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .locator(".command")
    .first();
  const commandLayout = await firstCommand.evaluate((element) => {
    const icon = element
      .querySelector(".command-open ha-icon")
      ?.getBoundingClientRect();
    const name = element
      .querySelector(".command-open strong")
      ?.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      height: box.height,
      iconRight: icon?.right || 0,
      nameLeft: name?.left || 0,
    };
  });
  assert.ok(commandLayout.height <= 112, "Command cards should remain compact");
  assert.ok(
    commandLayout.nameLeft >= commandLayout.iconRight,
    "Command name should follow its icon",
  );
  await assertVisibleIconOnlyControls(
    page.locator("imprint-refinery-card"),
    "Remote profiles workspace",
  );

  await page
    .getByLabel("Search profiles and commands", { exact: true })
    .fill("Silkycasters");
  await open("library");
  assert.equal(
    await page
      .getByLabel("Search profiles and commands", { exact: true })
      .inputValue(),
    "Silkycasters",
    "Remote-profile search did not survive refresh",
  );
  await page
    .getByLabel("Search profiles and commands", { exact: true })
    .fill("");
  const persistenceProfile = page.locator(".profile", {
    hasText: "Silkycasters RGBW",
  });
  await persistenceProfile
    .getByRole("button", { name: "Select", exact: true })
    .click();
  await persistenceProfile
    .getByRole("checkbox", { name: "Power", exact: true })
    .check();
  await persistenceProfile.getByText("1 selected", { exact: true }).waitFor();
  const storedWorkspaceSession = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem("imprint-refinery:workspace-state:v1") || "null",
    ),
  );
  assert.deepEqual(storedWorkspaceSession.commandSelection, {
    remoteProfileId: "silkycasters_rgbw",
    commandIds: ["power"],
  });
  await open("library");
  const restoredSelectionProfile = page.locator(".profile", {
    hasText: "Silkycasters RGBW",
  });
  await restoredSelectionProfile
    .getByText("1 selected", { exact: true })
    .waitFor();
  await restoredSelectionProfile
    .getByRole("button", { name: "Done", exact: true })
    .click();

  const sharedProfile = page.locator(".profile", {
    hasText: "Silkycasters RGBW",
  });
  await sharedProfile
    .getByRole("button", { name: "Actions for Silkycasters RGBW", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Delete profile", exact: true })
    .click();
  const blockedDelete = page.getByRole("dialog", {
    name: "Delete remote profile?",
  });
  await blockedDelete.waitFor();
  assert.equal(
    await blockedDelete.getByText("Sconce 1", { exact: true }).count(),
    1,
  );
  assert.equal(
    await blockedDelete.getByText("Sconce 2", { exact: true }).count(),
    1,
  );
  assert.equal(
    await blockedDelete
      .getByRole("button", { name: "Delete", exact: true })
      .isDisabled(),
    true,
    "A shared remote profile must not be deletable",
  );
  await blockedDelete
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  const powerCard = sharedProfile.locator(".command", { hasText: "Power" });
  await powerCard
    .getByRole("button", { name: "Actions for Power", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Choose icon", exact: true })
    .click();
  const iconDialog = page.getByRole("dialog", { name: "Choose icon" });
  await iconDialog.waitFor();
  assert.equal(
    await iconDialog.getByText("Custom icon", { exact: true }).count(),
    1,
  );
  const useDefault = iconDialog.getByRole("button", {
    name: "Use default",
    exact: true,
  });
  assert.equal(await useDefault.isEnabled(), true);
  await useDefault.click();
  assert.equal(
    await iconDialog.getByText("Default icon", { exact: true }).count(),
    1,
  );
  assert.equal(await useDefault.isDisabled(), true);
  await iconDialog
    .getByLabel("Home Assistant icon", { exact: true })
    .fill("mdi:flash");
  await iconDialog.getByRole("button", { name: "Save", exact: true }).click();
  await iconDialog.waitFor({ state: "hidden" });
  const iconCall = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.find(
      (call) =>
        call.action === "update_command" && call.data.icon === "mdi:flash",
    ),
  );
  assert.equal(iconCall.data.command_id, "power");

  await sharedProfile
    .getByRole("button", { name: "Select", exact: true })
    .click();
  await sharedProfile.getByText("0 selected", { exact: true }).waitFor();
  await sharedProfile
    .getByRole("checkbox", { name: "Select all", exact: true })
    .check();
  await sharedProfile.getByText("4 selected", { exact: true }).waitFor();
  await sharedProfile
    .getByRole("checkbox", { name: "Power", exact: true })
    .uncheck();
  await sharedProfile
    .getByRole("checkbox", { name: "Timer: 1h", exact: true })
    .uncheck();
  await sharedProfile.getByText("2 selected", { exact: true }).waitFor();
  await sharedProfile
    .getByRole("button", { name: "Move to another profile", exact: true })
    .click();
  const moveDialog = page.getByRole("dialog", { name: "Move commands" });
  await moveDialog.waitFor();
  assert.equal(
    await moveDialog.getByLabel("Destination remote profile").inputValue(),
    "television_remote",
  );
  assert.equal(
    await moveDialog.getByText(/keeps its complete revision history/).count(),
    1,
  );
  await moveDialog
    .getByRole("button", { name: "Move commands", exact: true })
    .click();
  await moveDialog.waitFor({ state: "hidden" });
  assert.equal(
    await sharedProfile.getByText("Warm white", { exact: true }).count(),
    0,
  );
  const televisionProfile = page.locator(".profile", {
    hasText: "Example television remote",
  });
  assert.equal(
    await televisionProfile.getByText("Warm white", { exact: true }).count(),
    1,
  );
  assert.equal(
    await televisionProfile.getByText("Blue", { exact: true }).count(),
    1,
  );
  const movedCommands = await page.evaluate(() => ({
    calls: window.__IMPRINT_REFINERY_FIXTURES__.calls.filter(
      (call) => call.action === "move_command",
    ),
    warmWhiteRevisions:
      window.__IMPRINT_REFINERY_FIXTURES__.workspaceRegistry.remote_profiles
        .television_remote.commands.warm_white.revision_count,
    blueRevisions:
      window.__IMPRINT_REFINERY_FIXTURES__.workspaceRegistry.remote_profiles
        .television_remote.commands.blue.revision_count,
  }));
  assert.deepEqual(
    movedCommands.calls.map((call) => call.data.command_id).sort(),
    ["blue", "warm_white"],
  );
  assert.deepEqual(
    [movedCommands.warmWhiteRevisions, movedCommands.blueRevisions],
    [1, 1],
    "Bulk moves must preserve each command's existing revision history",
  );

  await page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .locator(".command-open", { hasText: "Power" })
    .click();
  const commandInspector = page.getByRole("complementary", {
    name: "Command details",
  });
  await commandInspector.waitFor();
  const inspectorFacts = commandInspector
    .locator("dl.imprint-fact-grid")
    .first();
  assert.ok(
    (await inspectorFacts.locator("dt").count()) > 0,
    "Inspector facts should use semantic terms",
  );
  assert.equal(
    await inspectorFacts.locator("dt").count(),
    await inspectorFacts.locator("dd").count(),
    "Inspector fact labels and values should remain paired",
  );
  assert.equal(
    await commandInspector
      .getByText("Ready-to-use Home Assistant action", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await commandInspector
      .getByRole("button", { name: "Copy action", exact: true })
      .count(),
    1,
  );
  const inspectorTabs = commandInspector.getByRole("tab");
  await inspectorTabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(20);
  assert.equal(
    await inspectorTabs.nth(1).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await inspectorTabs
      .nth(1)
      .evaluate((element) => element.matches(":focus-within")),
    true,
  );
  assert.equal(
    await commandInspector
      .getByRole("button", { name: "Copy timings", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await commandInspector
      .getByText("Captured repeats", { exact: true })
      .count(),
    1,
  );
  await commandInspector
    .getByRole("button", { name: "Zoom in", exact: true })
    .click();
  assert.match(page.url(), /zoom[=/]2(?:$|[&#/?])/);
  await commandInspector
    .getByRole("button", { name: "Copy timings", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Timings copied." })
    .waitFor();
  await inspectorTabs.nth(1).focus();
  await page.keyboard.press("End");
  assert.equal(
    await inspectorTabs.last().getAttribute("aria-selected"),
    "true",
  );
  await inspectorTabs.last().focus();
  await page.keyboard.press("Home");
  assert.equal(
    await inspectorTabs.first().getAttribute("aria-selected"),
    "true",
  );
  const editCommandButton = commandInspector.getByRole("button", {
    name: "Edit",
    exact: true,
  });
  await editCommandButton.click();
  let commandEdit = page.getByRole("dialog", { name: "Edit command" });
  await commandEdit.waitFor();
  await assertFocusContained(commandEdit, "Edit command dialog");
  await page.keyboard.press("Escape");
  await commandEdit.waitFor({ state: "hidden" });
  assert.equal(
    await editCommandButton.evaluate((element) => element.matches(":focus")),
    true,
    "Edit command dialog did not restore focus to its opener",
  );
  await editCommandButton.click();
  commandEdit = page.getByRole("dialog", { name: "Edit command" });
  await commandEdit.waitFor();
  const editCommandWorkflow = page.locator('[data-workflow="edit-command"]');
  assert.equal(await editCommandWorkflow.getByRole("note").count(), 1);
  assert.equal(await editCommandWorkflow.getByRole("alert").count(), 0);
  assert.equal(
    await editCommandWorkflow.getByLabel("Command name").inputValue(),
    "Power",
  );
  assert.equal(
    await editCommandWorkflow.getByLabel("Remote profile").inputValue(),
    "silkycasters_rgbw",
  );
  assert.equal(
    await editCommandWorkflow
      .getByText(/shared.*affects every appliance/i)
      .count(),
    1,
  );
  await editCommandWorkflow.evaluate((dialog) => {
    window.__IMPRINT_REFINERY_FIXTURES__.generalDialogClosed = 0;
    dialog.addEventListener(
      "closed",
      () => {
        window.__IMPRINT_REFINERY_FIXTURES__.generalDialogClosed += 1;
      },
      { once: true },
    );
  });
  await editCommandWorkflow
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await commandEdit.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(
      () => window.__IMPRINT_REFINERY_FIXTURES__.generalDialogClosed,
    ),
    1,
    "General workflow Cancel bypassed the native ha-dialog closed event",
  );
  assert.equal(
    await editCommandButton.evaluate((element) => element.matches(":focus")),
    true,
    "General workflow native Cancel did not restore focus to its opener",
  );

  await commandInspector
    .getByRole("button", { name: "Duplicate", exact: true })
    .click();
  const duplicateCommand = page.getByRole("dialog", {
    name: "Duplicate command",
  });
  await duplicateCommand.waitFor();
  await assertFocusContained(duplicateCommand, "Duplicate command dialog");
  const duplicateWorkflow = page.locator('[data-workflow="duplicate-command"]');
  assert.equal(
    await duplicateWorkflow.getByLabel("Command name").inputValue(),
    "Power",
  );
  assert.equal(
    await duplicateWorkflow.getByLabel("Command ID").inputValue(),
    "power",
  );
  assert.equal(
    await duplicateWorkflow.getByLabel("Remote profile").inputValue(),
    "spare_remote",
  );
  await duplicateWorkflow
    .getByLabel("Remote profile")
    .selectOption("television_remote");
  assert.equal(
    await duplicateWorkflow.getByLabel("Command ID").inputValue(),
    "power_copy",
  );
  await duplicateWorkflow.getByLabel("Command ID").fill("main_power");
  await duplicateWorkflow
    .getByRole("button", { name: "Duplicate", exact: true })
    .click();
  await duplicateCommand.waitFor({ state: "hidden" });
  await commandInspector
    .getByText("Example television remote", { exact: true })
    .waitFor();
  const duplicateCall = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.find(
      (call) => call.action === "duplicate_command",
    ),
  );
  assert.deepEqual(duplicateCall.data, {
    remote_profile_id: "silkycasters_rgbw",
    command_id: "power",
    target_remote_profile_id: "television_remote",
    target_command_id: "main_power",
    name: "Power",
  });

  await commandInspector
    .getByRole("button", { name: "Open in Signal Lab", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Signal Lab", exact: true })
    .waitFor();
  const retainedDraftCommandId = await page
    .locator("imprint-refinery-card")
    .evaluate((card) => card.lab.commandId);
  assert.equal(
    await page.getByText("Original is protected", { exact: true }).count(),
    1,
  );
  const waveformUpdates = await page
    .locator("imprint-signal-lab")
    .evaluate(async (lab) => {
    const waveform = lab.shadowRoot.querySelector("imprint-signal-waveform");
    await waveform.updateComplete;
    const originalPerformUpdate = waveform.performUpdate;
    let updates = 0;
    waveform.performUpdate = function (...args) {
      updates += 1;
      return originalPerformUpdate.apply(this, args);
    };
    lab.message = "Unrelated status update";
    await lab.updateComplete;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    waveform.performUpdate = originalPerformUpdate;
    return updates;
  });
  assert.equal(
    waveformUpdates,
    0,
    "An unrelated Signal Lab update rerendered waveform geometry",
  );
  const historyLengthBeforeViewportChanges = await page.evaluate(
    () => history.length,
  );
  await page.locator("imprint-refinery-card").evaluate((card) => {
    card.labController.handle({ action: "zoom", zoom: 2, pan: 0.1 });
    card.labController.handle({ action: "zoom", zoom: 3, pan: 0.2 });
  });
  assert.equal(
    await page.evaluate(() => history.length),
    historyLengthBeforeViewportChanges,
    "Continuous Signal Lab viewport changes must replace, not flood, browser history",
  );
  assert.match(page.url(), /zoom[=/]3/);
  await page.locator("imprint-refinery-card").evaluate((card) => {
    card.labController.handle({ action: "nudge", index: 0, amount: 10 });
  });
  await page
    .getByRole("button", { name: "Return to remote profiles", exact: true })
    .click();
  const leaveSignalLab = page.getByRole("dialog", {
    name: "Leave Signal Lab?",
  });
  await leaveSignalLab.waitFor();
  await leaveSignalLab
    .getByRole("button", { name: "Keep draft", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Remote profiles", exact: true })
    .waitFor();
  await page.getByText("Signal Lab draft saved", { exact: true }).waitFor();

  await page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .locator(".command-open", { hasText: "Timer: 1h" })
    .click();
  const secondInspector = page.getByRole("complementary", {
    name: "Command details",
  });
  await secondInspector
    .getByRole("button", { name: "Open in Signal Lab", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Signal Lab", exact: true })
    .waitFor();
  const storedDraftState = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem("imprint-refinery:signal-lab-drafts:v2") || "null",
    ),
  );
  assert.equal(Object.keys(storedDraftState.drafts).length, 2);
  assert.match(storedDraftState.suspendedKey, /power/);
  await page
    .getByRole("button", { name: "Return to remote profiles", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Remote profiles", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await page
    .getByRole("heading", { name: "Signal Lab", exact: true })
    .waitFor();
  const resumedDraft = await page
    .locator("imprint-refinery-card")
    .evaluate((card) => ({
      commandId: card.lab.commandId,
      firstTiming: card.lab.timings[0],
      originalFirstTiming: card.lab.original[0],
    }));
  assert.equal(resumedDraft.commandId, retainedDraftCommandId);
  assert.equal(resumedDraft.firstTiming, resumedDraft.originalFirstTiming + 10);
  await page
    .getByRole("button", { name: "Return to remote profiles", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Leave Signal Lab?" })
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Remote profiles", exact: true })
    .waitFor();

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Backup & restore", exact: true })
    .click();
  const backupDialog = page.getByRole("dialog", { name: "Backup & restore" });
  await backupDialog.waitFor();
  const backupWorkflow = page.locator('[data-workflow="backup-restore"]');
  assert.match(
    await backupWorkflow.getByLabel("Export JSON").inputValue(),
    /imprint_refinery\.backup/,
  );
  const backupDownloadPromise = page.waitForEvent("download");
  await backupWorkflow
    .getByRole("button", { name: "Download JSON", exact: true })
    .click();
  const backupDownload = await backupDownloadPromise;
  assert.equal(
    backupDownload.suggestedFilename(),
    "imprint-refinery-backup.json",
  );
  const legacyBackup = {
    schema: "imprint_refinery.backup",
    version: 1,
    locations: {
      legacy: {
        appliances: { fan: { name: "Fan", commands: {} } },
      },
    },
  };
  await backupWorkflow.locator('input[type="file"]').setInputFiles({
    name: "legacy-imprint-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacyBackup)),
  });
  await backupWorkflow
    .getByText("legacy-imprint-backup.json", { exact: true })
    .waitFor();
  await backupWorkflow
    .getByRole("button", { name: "Review restore", exact: true })
    .click();
  await backupWorkflow.getByText("Fan", { exact: true }).waitFor();
  assert.equal(
    await backupWorkflow.getByText("Fan", { exact: true }).count(),
    1,
  );
  assert.equal(
    await backupWorkflow.getByLabel("Home Assistant Area").inputValue(),
    "living-room",
  );
  assert.equal(await backupWorkflow.getByLabel("IR emitter").inputValue(), "");
  await backupWorkflow
    .getByLabel("IR emitter")
    .selectOption("fixture-emitter-one");
  await backupWorkflow
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await backupDialog.waitFor({ state: "hidden" });
  const backupCalls = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.filter((call) =>
      ["inspect_import", "import_backup", "update_appliance"].includes(
        call.action,
      ),
    ),
  );
  const backupInspection = backupCalls.find(
    (call) => call.action === "inspect_import",
  );
  assert.equal(backupInspection.data.format, "native_json");
  const backupImport = backupCalls.find(
    (call) => call.action === "import_backup",
  );
  assert.deepEqual(JSON.parse(backupImport.data.code), legacyBackup);
  const applianceUpdate = backupCalls.find(
    (call) => call.action === "update_appliance",
  );
  assert.deepEqual(applianceUpdate.data, {
    appliance_id: "legacy__fan",
    area_id: "living-room",
    infrared_emitter_ref: "fixture-emitter-one",
  });

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import signals", exact: true })
    .click();
  const importDialog = page.getByRole("dialog", { name: "Import IR signals" });
  await importDialog.waitFor();
  const importWorkflow = page.locator('[data-workflow="import-signals"]');
  await importWorkflow
    .getByLabel("Remote profile")
    .selectOption("silkycasters_rgbw");
  await importWorkflow.locator('input[type="file"]').setInputFiles({
    name: "living-room.ir",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Filetype: IR signals file\nVersion: 1\n#\nname: Power",
    ),
  });
  await importWorkflow.getByText("living-room.ir", { exact: true }).waitFor();
  assert.equal(await importWorkflow.getByLabel("Format").inputValue(), "auto");
  await importWorkflow
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await importWorkflow.getByText("Imported power", { exact: true }).waitFor();
  await importWorkflow.getByText(/Detected format: flipper/).waitFor();
  await importWorkflow
    .getByText("Conversion and provenance details", { exact: true })
    .waitFor();
  await importWorkflow
    .getByText(/1 unsupported command will be skipped/)
    .waitFor();
  const importPreviewCall = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.find(
      (call) => call.action === "inspect_import" && call.data.format === "auto",
    ),
  );
  assert.equal(importPreviewCall.data.format, "auto");
  assert.equal(
    await importWorkflow.getByText("Imported power", { exact: true }).count(),
    1,
  );
  assert.equal(
    await importWorkflow
      .getByRole("button", { name: "Import commands", exact: true })
      .isEnabled(),
    true,
  );
  const storeCallsBeforeImport = await page.evaluate(
    () =>
      window.__IMPRINT_REFINERY_FIXTURES__.calls.filter(
        (call) => call.action === "store_command",
      ).length,
  );
  await importWorkflow
    .getByRole("button", { name: "Import commands", exact: true })
    .click();
  await importDialog.waitFor({ state: "hidden" });
  const importedStoreCalls = await page.evaluate(
    (before) =>
      window.__IMPRINT_REFINERY_FIXTURES__.calls
        .filter((call) => call.action === "store_command")
        .slice(before),
    storeCallsBeforeImport,
  );
  assert.equal(
    importedStoreCalls.length,
    1,
    "Unsupported imports must be excluded",
  );
  assert.equal(importedStoreCalls[0].data.command_id, "imported_power");
  assert.equal(importedStoreCalls[0].data.source.format, "flipper");

  await page.getByRole("button", { name: "Find codes", exact: true }).click();
  const catalogDialog = page.getByRole("dialog", { name: "Find remote codes" });
  await catalogDialog.waitFor();
  const catalogWorkflow = page.locator('[data-workflow^="catalog-"]');
  const catalogMethodTiles = catalogWorkflow.locator(
    ".imprint-action-tile-trigger",
  );
  const catalogMethodGeometry = async () =>
    catalogMethodTiles.evaluateAll((tiles) =>
      tiles.map((tile) => {
        const bounds = tile.getBoundingClientRect();
        const title = tile.querySelector("strong")?.getBoundingClientRect();
        const description = tile
          .querySelector(".imprint-action-tile-copy > span")
          ?.getBoundingClientRect();
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          scrollHeight: tile.scrollHeight,
          clientHeight: tile.clientHeight,
          titleTop: title?.top,
          titleBottom: title?.bottom,
          descriptionTop: description?.top,
          descriptionBottom: description?.bottom,
        };
      }),
    );
  assert.equal(await catalogMethodTiles.count(), 2);
  let methodGeometry = await catalogMethodGeometry();
  for (const tile of methodGeometry) {
    assert.ok(tile.scrollHeight <= tile.clientHeight + 1);
    assert.ok(tile.titleTop >= tile.top);
    assert.ok(tile.titleBottom <= tile.descriptionTop);
    assert.ok(tile.descriptionBottom <= tile.bottom);
  }
  assert.ok(Math.abs(methodGeometry[0].top - methodGeometry[1].top) <= 1);
  await page.setViewportSize({ width: 390, height: 844 });
  methodGeometry = await catalogMethodGeometry();
  assert.ok(methodGeometry[1].top > methodGeometry[0].bottom);
  for (const tile of methodGeometry) {
    assert.ok(tile.scrollHeight <= tile.clientHeight + 1);
    assert.ok(tile.descriptionBottom <= tile.bottom);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await catalogWorkflow
    .getByRole("button", { name: /Identify from one button/ })
    .click();
  await catalogWorkflow
    .getByLabel("IR receiver")
    .selectOption("fixture-receiver-one");
  await catalogWorkflow
    .getByRole("button", { name: "Capture a button", exact: true })
    .click();
  const identifyListening = catalogWorkflow.locator(
    '[data-capture-phase="listening"]',
  );
  await identifyListening.waitFor();
  assert.equal(
    await identifyListening.getByText(/Preparing .* for capture/).count(),
    1,
  );
  await catalogWorkflow
    .locator('[data-capture-phase="processing"]')
    .waitFor();
  await catalogWorkflow
    .getByText("No catalog match", { exact: true })
    .waitFor();
  const identifyCaptureCall = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.find(
      (call) => call.action === "capture_signal",
    ),
  );
  assert.equal(
    identifyCaptureCall.data.infrared_receiver_ref,
    "fixture-receiver-one",
  );
  await catalogWorkflow
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await catalogWorkflow
    .getByRole("button", { name: /Guided appliance test/ })
    .click();
  await catalogWorkflow.getByLabel("Category").selectOption("tv");
  await catalogWorkflow.getByLabel("Brand").fill("Vizio");
  await catalogWorkflow
    .getByLabel("Test with IR emitter")
    .selectOption("fixture-emitter-one");
  await catalogWorkflow
    .getByRole("button", { name: "Start guided matching", exact: true })
    .click();
  assert.equal(
    await catalogWorkflow
      .getByRole("button", { name: "Worked", exact: true })
      .isDisabled(),
    true,
  );
  await catalogWorkflow
    .getByRole("button", { name: "Test once", exact: true })
    .click();
  assert.equal(
    await catalogWorkflow
      .getByRole("button", { name: "Worked", exact: true })
      .isEnabled(),
    true,
  );
  const guidedTestCall = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.find(
    (call) => call.action === "catalog_guided_test",
    ),
  );
  assert.equal(guidedTestCall.data.infrared_emitter_ref, "fixture-emitter-one");
  await catalogWorkflow
    .getByRole("button", { name: "Worked", exact: true })
    .click();
  await catalogWorkflow.getByLabel("Matching remote profile").waitFor();
  await catalogWorkflow
    .getByRole("button", { name: "Keep testing", exact: true })
    .click();
  await catalogWorkflow
    .getByRole("button", { name: "Cancel guided matching", exact: true })
    .click();
  await catalogWorkflow
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await catalogWorkflow.getByLabel("Brand").fill("Vizio");
  await catalogWorkflow
    .getByRole("button", { name: "Search catalog", exact: true })
    .click();
  await catalogWorkflow
    .getByRole("button", { name: "Review profile", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Review remote profile" }).waitFor();
  await catalogWorkflow
    .getByText("Profile provenance", { exact: true })
    .waitFor();
  assert.equal(
    await catalogWorkflow
      .getByRole("button", { name: "Import starter (4)", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await catalogWorkflow
      .getByRole("button", { name: "Import selected (4)", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await catalogWorkflow
      .getByRole("button", { name: "Import all (5)", exact: true })
      .count(),
    1,
  );
  await catalogWorkflow
    .getByRole("button", { name: "Test once", exact: true })
    .first()
    .click();
  const catalogTestCall = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.find(
      (call) => call.action === "send_signal",
    ),
  );
  assert.equal(
    catalogTestCall.data.infrared_emitter_ref,
    "fixture-emitter-one",
  );
  await catalogWorkflow
    .getByRole("button", { name: "Import selected (4)", exact: true })
    .click();
  const importedDialog = page.getByRole("dialog", {
    name: "Remote profile imported",
  });
  await importedDialog.waitFor();
  assert.equal(
    await catalogWorkflow
      .getByRole("button", { name: "Create appliance", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await catalogWorkflow.getByLabel("Assign to an existing appliance").count(),
    1,
  );
  await catalogWorkflow
    .getByRole("button", { name: "Create appliance", exact: true })
    .click();
  const addApplianceDialog = page.getByRole("dialog", {
    name: "Add appliance",
  });
  await addApplianceDialog.waitFor();
  const addApplianceWorkflow = page.locator('[data-workflow="appliance"]');
  assert.equal(
    await addApplianceWorkflow.getByLabel("Remote profile").inputValue(),
    "vizio_common_tv_family",
  );
  await addApplianceWorkflow
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  const testSelect = page.getByLabel("Test with IR emitter", { exact: true });
  await testSelect.selectOption("fixture-emitter-one");
  assert.equal(
    await page
      .locator("imprint-refinery-card")
      .evaluate((card) => card.testEmitterRef),
    "fixture-emitter-one",
    "Temporary test-emitter selection did not reach the workspace controller",
  );
  await page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .getByRole("button", { name: "Test Power", exact: true })
    .click();
  await page.getByText(/Sent Power once/).waitFor();
  assert.equal(
    await page
      .getByRole("status")
      .filter({ hasText: /Sent Power once/ })
      .count(),
    1,
    "Successful sends should be announced once as a polite status",
  );
  const calls = await page.evaluate(
    () => window.__IMPRINT_REFINERY_FIXTURES__.calls,
  );
  const send = calls.filter((call) => call.action === "send_signal").at(-1);
  assert.equal(send.data.infrared_emitter_ref, "fixture-emitter-one");

  await page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .getByRole("button", { name: "Learn command", exact: true })
    .click();
  const learnChooser = page.getByRole("dialog", {
    name: "Choose an IR receiver",
  });
  await learnChooser.waitFor();
  assert.equal(
    await learnChooser.getByLabel(/^IR receiver/).inputValue(),
    "fixture-receiver-one",
    "The matching receiver should be suggested without starting capture",
  );
  await learnChooser
    .getByRole("button", { name: "Begin listening", exact: true })
    .click();
  const learn = page.getByRole("dialog", { name: "Command captured" });
  await learn.waitFor();
  const learnWorkflow = page.locator('[data-workflow="learn-command-review"]');
  assert.equal(
    await page
      .locator("imprint-refinery-card")
      .evaluate((card) => card.dialog?.data?.infrared_receiver_ref),
    "fixture-receiver-one",
    "Confirmed IR receiver was not retained for the learning session",
  );
  assert.equal(
    await learnWorkflow.locator("imprint-signal-waveform").count(),
    1,
  );
  assert.equal(
    await learnWorkflow.getByText(/Nothing is saved until/).count(),
    1,
  );
  await page.keyboard.press("Escape");
  await learn.waitFor({ state: "hidden" });
  await testSelect.selectOption("");
  await page
    .locator(".profile", { hasText: "Spare remote" })
    .getByRole("button", { name: "Learn command", exact: true })
    .first()
    .click();
  const ambiguousLearn = page.getByRole("dialog", {
    name: "Choose an IR receiver",
  });
  await ambiguousLearn.waitFor();
  const ambiguousLearnWorkflow = page.locator(
    '[data-workflow="learn-command-choose"]',
  );
  assert.equal(
    await ambiguousLearnWorkflow.getByLabel(/^IR receiver/).inputValue(),
    "",
  );
  await ambiguousLearnWorkflow
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await page.getByRole("tab", { name: "Appliances", exact: true }).click();
  await page
    .getByRole("heading", { name: "Appliances", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Sconce 1", exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByRole("heading", { name: "Sconce 2", exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByText("Silkycasters RGBW", { exact: true }).count(),
    2,
  );
  assert.equal(
    await page.getByText("Emitter unavailable", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .locator('[data-appliance-id="living_room_sconce_2"]')
      .getByText("Entity available", { exact: true })
      .count(),
    0,
    "Healthy entity status must not compete with the route warning",
  );
  assert.equal(
    await page
      .locator('[data-appliance-id="living_room_tv"]')
      .getByText("Entity unavailable", { exact: true })
      .count(),
    1,
  );
  await assertVisibleIconOnlyControls(
    page.locator('[data-workspace="appliances"]'),
    "Appliances workspace",
  );
  await page
    .locator(".appliance", { hasText: "Sconce 1" })
    .getByRole("button", { name: "Edit Sconce 1", exact: true })
    .click();
  const applianceDialog = page.getByRole("dialog", { name: "Edit appliance" });
  await applianceDialog.waitFor();
  const applianceWorkflow = page.locator('[data-workflow="appliance"]');
  assert.equal(
    await applianceWorkflow.getByLabel("Home Assistant Area").inputValue(),
    "living-room",
  );
  assert.equal(
    await applianceWorkflow.getByLabel("Remote profile").inputValue(),
    "silkycasters_rgbw",
  );
  assert.equal(
    await applianceWorkflow.getByLabel("Preferred IR emitter").inputValue(),
    "fixture-emitter-one",
  );
  await applianceWorkflow
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  const routeIoBefore = await infraredIoCounts();
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "appliances");
    url.searchParams.set("appliance", "living_room_sconce_2");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const selectedAppliance = page.locator(
    '[data-appliance-id="living_room_sconce_2"]',
  );
  await selectedAppliance.waitFor();
  assert.equal(
    await selectedAppliance.evaluate((element) => element.matches(":focus")),
    true,
  );
  assert.deepEqual(
    await infraredIoCounts(),
    routeIoBefore,
    "Restoring an appliance deep link restarted infrared capture or transmission",
  );
  const sconceOne = page.locator(".appliance", { hasText: "Sconce 1" });
  await sconceOne
    .getByRole("button", { name: "Actions for Sconce 1", exact: true })
    .click();
  await sconceOne.getByText("Open remote profile", { exact: true }).click();
  const selectedProfile = page.locator(
    'article[data-profile-id="silkycasters_rgbw"]',
  );
  await selectedProfile.waitFor();
  assert.equal(
    await selectedProfile.evaluate((element) => element.matches(":focus")),
    true,
  );
  assert.match(page.url(), /view=remote_profiles/);
  assert.match(page.url(), /profile=silkycasters_rgbw/);

  await page
    .getByRole("tab", { name: "Infrared hardware", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Infrared hardware", exact: true })
    .waitFor();
  assert.equal(await page.getByText("IR emitters", { exact: true }).count(), 1);
  assert.equal(
    await page.getByText("IR receivers", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByText("Living room IR", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByText("Living room receiver", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByText("Bedroom receiver", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByRole("link", { name: /Open .* entity/ }).count(),
    4,
  );
  assert.equal(
    await page.getByText("Last state update", { exact: true }).count(),
    4,
  );
  assert.equal(
    await page
      .locator('[data-hardware-ref="fixture-emitter-one"] time')
      .getAttribute("datetime"),
    "2000-01-01T00:00:00Z",
  );
  assert.equal(await page.locator(".hardware-row-primary").count(), 4);
  assert.equal(
    await page.getByRole("button", { name: /^Actions for / }).count(),
    4,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Add compatibility adapter", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.getByRole("button", { name: /Delete/ }).count(), 0);

  await page.evaluate(
    () =>
      import("/custom_components/imprint_refinery/www/imprint-refinery-card.js?duplicate-load-smoke"),
  );
  assert.equal(
    await page.evaluate(
      () =>
      (window.customCards || []).filter(
        (card) => card.type === "imprint-refinery-card",
      ).length,
    ),
    1,
    "Duplicate bundle loads should not duplicate the custom card registry entry",
  );
  assert.equal(errors.length, 0, `Browser errors: ${errors.join("\n")}`);
  await noOverflow("desktop workspace");

  await open("library", 900, 900, { presentation: "card" });
  const cardShell = page.locator("imprint-refinery-card");
  assert.equal(await cardShell.evaluate((card) => card.presentation), "card");
  assert.equal(await cardShell.locator("ha-card").count(), 1);
  assert.equal(await cardShell.locator(".compact-card").count(), 1);
  assert.equal(await cardShell.locator(".workspace-header").count(), 0);
  assert.equal(
    (await cardShell.locator(".compact-command-row").count()) > 0,
    true,
  );
  assert.equal(
    (await cardShell.locator(".compact-command-row").count()) <= 12,
    true,
  );
  await cardShell
    .getByRole("button", { name: "Send Power to Sconce 1", exact: true })
    .click();
  const compactSend = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.find(
      (call) =>
        call.transport === "service" &&
        call.domain === "remote" &&
        call.service === "send_command",
    ),
  );
  assert.deepEqual(compactSend?.data, {
    entity_id: "remote.sconce_1",
    command: "power",
    num_repeats: 1,
    delay_secs: 0.4,
  });
  assert.equal(
    await page.evaluate(() =>
      window.__IMPRINT_REFINERY_FIXTURES__.calls.some(
      (call) => call.transport === "ws" && call.action === "send_signal",
      ),
    ),
    false,
  );
  assert.equal(
    await cardShell.evaluate(
      (card) =>
        getComputedStyle(card.shadowRoot.querySelector(".compact-card"))
          .minHeight,
    ),
    "0px",
    "Lovelace card mode should remain content-height rather than viewport-height",
  );

  await open("library", 900, 900, { optionalPicker: true });
  const pickerCard = page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .locator(".command", { hasText: "Power" });
  await pickerCard
    .getByRole("button", { name: "Actions for Power", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Choose icon", exact: true })
    .click();
  const pickerDialog = page.getByRole("dialog", { name: "Choose icon" });
  const iconPicker = pickerDialog.locator("ha-icon-picker");
  await iconPicker
    .getByRole("button", { name: "Home Assistant icon", exact: true })
    .click();
  assert.equal(await iconPicker.evaluate((element) => element.open), true);
  await page.keyboard.press("Escape");
  assert.equal(await iconPicker.evaluate((element) => element.open), false);
  assert.equal(
    await pickerDialog.isVisible(),
    true,
    "Closing a nested picker dismissed its workflow",
  );
  await page.keyboard.press("Escape");
  await pickerDialog.waitFor({ state: "hidden" });

  await open("library", 1100, 900);
  await page
    .locator("imprint-refinery-card")
    .evaluate((card) =>
      card.openCommand(
        "silkycasters_rgbw",
        "power",
        "history",
        true,
        "auto",
        "",
        999,
      ),
    );
  const narrowInspector = page.getByLabel("Command details", { exact: true });
  await narrowInspector.waitFor();
  await narrowInspector
    .getByRole("button", { name: "Revision 4", exact: true })
    .waitFor();
  const selectedRevisionContrast = await narrowInspector
    .locator('ha-button[aria-label="Revision 4"]')
    .evaluate((button) => {
      const parseColor = (value) =>
        (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (value) => {
        const channels = parseColor(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return (
          0.2126 * channels[0] +
          0.7152 * channels[1] +
          0.0722 * channels[2]
        );
      };
      const contrast = (foreground, background) => {
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(background);
        return (
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        );
      };
      const base = button.shadowRoot?.querySelector("button, a");
      const title = button.querySelector("strong");
      const detail = button.querySelector("small");
      const backgroundColor = getComputedStyle(base).backgroundColor;
      const titleColor = getComputedStyle(title).color;
      const detailColor = getComputedStyle(detail).color;
      return {
        titleColor,
        detailColor,
        detailContrast: contrast(detailColor, backgroundColor),
      };
    });
  assert.equal(
    selectedRevisionContrast.detailColor,
    selectedRevisionContrast.titleColor,
    "Selected revision detail text did not inherit the HA button foreground",
  );
  assert.ok(
    selectedRevisionContrast.detailContrast >= 4.5,
    `Selected revision detail contrast was ${selectedRevisionContrast.detailContrast.toFixed(2)}:1`,
  );
  const narrowRevisionGeometry = await narrowInspector
    .locator('ha-button[aria-label="Revision 4"]')
    .evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const title = button.querySelector("strong")?.getBoundingClientRect();
      const detail = button.querySelector("small")?.getBoundingClientRect();
      return {
        top: bounds.top,
        bottom: bounds.bottom,
        titleTop: title?.top,
        titleBottom: title?.bottom,
        detailTop: detail?.top,
        detailBottom: detail?.bottom,
      };
    });
  assert.ok(narrowRevisionGeometry.titleTop >= narrowRevisionGeometry.top);
  assert.ok(
    narrowRevisionGeometry.titleBottom <= narrowRevisionGeometry.detailTop,
  );
  assert.ok(
    narrowRevisionGeometry.detailBottom <= narrowRevisionGeometry.bottom,
  );
  assert.doesNotMatch(page.url(), /revision[=/]999/);
  assert.match(page.url(), /revision[=/]4/);
  assert.equal(
    await narrowInspector
      .getByText("Optimized for a single press", { exact: true })
      .count(),
    1,
  );
  await narrowInspector
    .getByRole("button", { name: "Revision 3", exact: true })
    .click();
  assert.equal(
    await narrowInspector
      .getByText("Trimmed trailing silence", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await narrowInspector.getByText("Parent", { exact: true }).count(),
    1,
  );
  assert.ok(
    (await narrowInspector.getByText("Revision 2", { exact: true }).count()) >=
      1,
  );
  assert.equal(
    await narrowInspector
      .getByText("Recognition evidence", { exact: true })
      .count(),
    1,
  );
  const commandBackupDownload = page.waitForEvent("download");
  await narrowInspector
    .getByRole("button", { name: "Download command backup", exact: true })
    .click();
  const commandBackup = await commandBackupDownload;
  const commandBackupPath = await commandBackup.path();
  assert.ok(commandBackupPath, "Command backup download had no readable path");
  const commandBackupDocument = JSON.parse(
    await readFile(commandBackupPath, "utf8"),
  );
  assert.equal(commandBackupDocument.history, "full");
  assert.equal(commandBackupDocument.command_count, 1);
  assert.deepEqual(commandBackupDocument.appliances, {});
  assert.equal(
    commandBackupDocument.remote_profiles.silkycasters_rgbw.commands.power
      .revisions.length,
    4,
  );
  const revisionLabel = narrowInspector.getByLabel("Revision label", {
    exact: true,
  });
  await revisionLabel.fill("Reviewed timing");
  await narrowInspector
    .getByRole("button", { name: "Save label", exact: true })
    .click();
  const labelCall = await page.evaluate(() =>
    window.__IMPRINT_REFINERY_FIXTURES__.calls.find(
    (call) => call.action === "label_revision",
    ),
  );
  assert.deepEqual(labelCall.data, {
    remote_profile_id: "silkycasters_rgbw",
    command_id: "power",
    revision_id: 3,
    label: "Reviewed timing",
  });
  await narrowInspector
    .getByRole("button", { name: "Compare", exact: true })
    .click();
  const revisionComparison = page.getByRole("dialog", {
    name: "Revision 3 compared with current",
    exact: true,
  });
  await revisionComparison.waitFor();
  await revisionComparison
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await revisionComparison.waitFor({ state: "hidden" });
  const revisionDownload = page.waitForEvent("download");
  await narrowInspector
    .getByRole("button", { name: "Export JSON", exact: true })
    .click();
  assert.match(
    (await revisionDownload).suggestedFilename(),
    /revision-3\.json$/,
  );
  await narrowInspector.getByRole("tab", { name: "Code", exact: true }).click();
  assert.equal(
    await narrowInspector
      .getByRole("heading", { name: "Raw bitstream", exact: true })
      .count(),
    1,
  );
  assert.equal(
    (
      await narrowInspector
        .getByLabel("Binary payload in transmission order")
        .textContent()
    )?.trim(),
    "00001000 11110111 00000100 11111011",
  );
  await narrowInspector
    .getByLabel("Bitstream decoder", { exact: true })
    .selectOption("pulse_distance");
  assert.equal(
    await page
      .locator("imprint-refinery-card")
      .evaluate((card) => card.inspector?.data?.binary_decoder_mode),
    "pulse_distance",
  );
  await narrowInspector
    .getByRole("button", { name: "Copy bits", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Raw bitstream copied." })
    .waitFor();
  const codeDownload = page.waitForEvent("download");
  await narrowInspector
    .getByRole("button", { name: "Download", exact: true })
    .click();
  assert.match((await codeDownload).suggestedFilename(), /\.txt$/);
  await narrowInspector
    .getByRole("tab", { name: "Overview", exact: true })
    .click();
  assert.equal(
    await narrowInspector
      .getByRole("button", { name: "Copy entity ID", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await narrowInspector.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
    true,
    "Narrow command inspector overflowed horizontally",
  );
  await noOverflow("narrow command inspector");

  await open("library", 760, 900);
  await noOverflow("760px workspace");

  await open("library", 1440, 1000, { hostWidth: 390 });
  await noHostOverflow("390px embedded workspace");
  await page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .locator(".command-open", { hasText: "Power" })
    .click();
  const embeddedInspector = page.getByRole("dialog", {
    name: "Power",
    exact: true,
  });
  await embeddedInspector.waitFor();
  await assertFocusContained(embeddedInspector, "Embedded command inspector");
  await noHostOverflow("390px embedded command inspector");
  await page.keyboard.press("Escape");
  await embeddedInspector.waitFor({ state: "hidden" });

  await open("library", 1440, 1000, { hostWidth: 320, textScale: 2 });
  await noHostOverflow("320px embedded workspace at 200% text");
  await noOverflow("320px embedded workspace at 200% text");

  await open("library", 390, 844, { textScale: 2 });
  await page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .locator(".command-open", { hasText: "Power" })
    .click();
  const scaledInspector = page.getByRole("dialog", {
    name: "Power",
    exact: true,
  });
  await scaledInspector.waitFor();
  const scaledInspectorLayout = await page
    .locator("aside[data-command-inspector]")
    .evaluate((aside) => {
      const buttons = [
        ...aside.querySelectorAll(".inspector-actions ha-button"),
      ].map((button) => {
      const rect = button.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
    });
      const overlaps = buttons.some((first, index) =>
        buttons
          .slice(index + 1)
          .some(
            (second) =>
              first.left < second.right &&
              first.right > second.left &&
              first.top < second.bottom &&
              first.bottom > second.top,
          ),
      );
    return {
        contained: buttons.every(
          ({ left, right }) => left >= 0 && right <= window.innerWidth,
        ),
      overlaps,
      overflowed: aside.scrollWidth > aside.clientWidth + 1,
    };
  });
  assert.deepEqual(scaledInspectorLayout, {
    contained: true,
    overlaps: false,
    overflowed: false,
  });
  await noOverflow("390px command inspector at 200% text");
  await scaledInspector
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await scaledInspector.waitFor({ state: "hidden" });

  await open("library", 390, 844);
  await noOverflow("mobile workspace");
  await assertVisibleIconOnlyControls(
    page.locator("imprint-refinery-card"),
    "Mobile remote profiles workspace",
  );
  await page.locator("imprint-refinery-card").evaluate(async (card) => {
    const registry = structuredClone(card.registry);
    registry.remote_profiles.silkycasters_rgbw.name =
      "Living room decorative wall-light controller with an intentionally long translated-style profile name";
    registry.appliances.living_room_sconce_1.name =
      "North alcove decorative wall light with an intentionally long translated-style appliance name";
    card.registry = registry;
    await card.updateComplete;
  });
  await noOverflow("mobile workspace with long names");
  await page.getByRole("tab", { name: "Appliances", exact: true }).click();
  await noOverflow("mobile appliances");
  await assertVisibleIconOnlyControls(
    page.locator('[data-workspace="appliances"]'),
    "Mobile appliances workspace",
  );

  const signalLabSaveHost = await openSignalLab("lab", 760, 900);
  await page
    .getByRole("button", { name: "Save as new command", exact: true })
    .click();
  const signalSaveDialog = page.locator('[data-workflow="signal-save"]');
  await signalSaveDialog.waitFor();
  await assertFocusContained(signalSaveDialog, "Signal save dialog");
  await signalLabSaveHost.evaluate(async (element) => {
    element.busy = true;
    await element.updateComplete;
  });
  await page.keyboard.press("Escape");
  assert.equal(
    await signalSaveDialog.isVisible(),
    true,
    "Busy Signal Lab save dialog closed before its work completed",
  );
  assert.equal(
    await signalLabSaveHost.evaluate((element) => element.saveOpen),
    true,
    "Busy Signal Lab save state cleared before the dialog closed",
  );
  await signalLabSaveHost.evaluate(async (element) => {
    element.busy = false;
    await element.updateComplete;
  });
  await page.keyboard.press("Escape");
  await signalSaveDialog.waitFor({ state: "hidden" });
  assert.equal(
    await signalLabSaveHost.evaluate((element) => element.saveOpen),
    false,
    "Signal Lab save state did not clear from the dialog closed event",
  );
  await page
    .getByRole("heading", { name: "Signal Lab", exact: true })
    .waitFor();

  const signalLabPreviewHost = await openSignalLab("lab-preview", 760, 900);
  const signalPreviewDialog = page.locator('[data-workflow="signal-preview"]');
  await signalPreviewDialog.waitFor();
  await assertFocusContained(signalPreviewDialog, "Signal preview dialog");
  await signalLabPreviewHost.evaluate(async (element) => {
    element.busy = true;
    await element.updateComplete;
  });
  await page.keyboard.press("Escape");
  assert.equal(
    await signalPreviewDialog.isVisible(),
    true,
    "Busy Signal Lab preview dialog closed before its work completed",
  );
  assert.equal(
    await signalLabPreviewHost.evaluate((element) =>
      Boolean(element.lab.preview),
    ),
    true,
    "Busy Signal Lab preview state cleared before the dialog closed",
  );
  await signalLabPreviewHost.evaluate(async (element) => {
    element.busy = false;
    await element.updateComplete;
  });
  await signalPreviewDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await signalPreviewDialog.waitFor({ state: "hidden" });
  assert.equal(
    await signalLabPreviewHost.evaluate((element) =>
      Boolean(element.lab.preview),
    ),
    false,
    "Signal Lab preview state did not clear from the dialog closed event",
  );
  await page
    .getByRole("heading", { name: "Signal Lab", exact: true })
    .waitFor();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSignalLab("lab");
  const reducedMotionStatus = page.locator(".irf-status").first();
  const signalLab = page.locator("imprint-signal-lab");
  const timerStarted = await signalLab.evaluate(async (element) => {
    element.busy = true;
    element.lab = { ...element.lab, testCooldownUntil: Date.now() + 2_000 };
    await element.updateComplete;
    return element.cooldownTimer !== undefined;
  });
  assert.equal(
    timerStarted,
    true,
    "Signal Lab did not start its bounded cooldown timer",
  );
  assert.equal(
    await reducedMotionStatus.evaluate(
      (element) =>
        getComputedStyle(element.querySelector(".irf-status-indicator"))
          .animationName,
    ),
    "none",
    "Busy status animation ignored reduced-motion preference",
  );
  const timerCleared = await signalLab.evaluate(async (element) => {
    element.remove();
    await Promise.resolve();
    return element.cooldownTimer === undefined;
  });
  assert.equal(
    timerCleared,
    true,
    "Signal Lab cooldown timer survived disconnection",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await open("no-blaster");
  assert.equal(
    await page
      .getByRole("heading", { name: "Silkycasters RGBW", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Test Power", exact: true })
      .first()
      .isDisabled(),
    true,
  );
  await page
    .getByRole("tab", { name: "Infrared hardware", exact: true })
    .click();
  assert.equal(
    await page
      .getByText("No Home Assistant IR emitter entities are available.", {
        exact: true,
      })
      .count(),
    1,
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `${server.origin}/tools/browser-fixtures/preview.html?view=unconfigured-appliance&theme=dark`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await page
    .getByRole("heading", { name: "Appliances", exact: true })
    .waitFor();
  const unconfiguredAppliance = page.locator(
    '[data-appliance-id="unconfigured_appliance"]',
  );
  assert.equal(
    await unconfiguredAppliance
      .getByText("Choose a remote profile", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await unconfiguredAppliance
      .getByText("Choose an IR emitter", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await unconfiguredAppliance
      .getByText("Setup required", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await unconfiguredAppliance
      .getByText("Open remote profile", { exact: true })
      .count(),
    0,
  );
  assert.deepEqual(
    await infraredIoCounts(),
    { sendSignal: 0, captureSignal: 0 },
    "Rendering an unconfigured appliance performed infrared I/O",
  );

  await open("no-receiver");
  await page
    .locator(".profile", { hasText: "Silkycasters RGBW" })
    .getByRole("button", { name: "Learn command", exact: true })
    .click();
  const noReceiverWorkflow = page.locator(
    '[data-workflow="learn-command-choose"]',
  );
  assert.equal(
    await noReceiverWorkflow
      .getByText(/No Home Assistant IR receiver is available/)
      .count(),
    1,
  );
  assert.equal(
    await noReceiverWorkflow
      .locator(".irf-notice", {
        hasText: /No Home Assistant IR receiver is available/,
      })
      .getAttribute("role"),
    "note",
    "Missing-receiver guidance should be a static note, not an alert",
  );
  assert.equal(
    await noReceiverWorkflow
      .getByRole("button", { name: "Begin listening", exact: true })
      .isDisabled(),
    true,
  );

  await open("compatibility-adapter");
  await page
    .getByRole("tab", { name: "Infrared hardware", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("link", { name: "Add compatibility adapter", exact: true })
      .count(),
    1,
  );

  await open("empty");
  assert.equal(
    await page.getByText("No appliances", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page.locator("ha-empty-state").count(),
    0,
    "Optional empty state must have an immediate fallback",
  );
  await open("empty", 1440, 1000, { optionalEmpty: true });
  assert.equal(
    await page.locator("ha-empty-state").count(),
    1,
    "Registered Home Assistant empty state should be used for a full workspace",
  );
  assert.equal(
    await page.getByText("No appliances", { exact: true }).count(),
    1,
  );

  const textareaFallbackPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await textareaFallbackPage.goto(
    `${server.origin}/tools/browser-fixtures/preview.html?view=library&theme=dark&missingTextarea=1`,
    { waitUntil: "networkidle" },
  );
  await textareaFallbackPage.waitForFunction(
    () => document.documentElement.dataset.fixtureReady === "true",
  );
  await textareaFallbackPage
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await textareaFallbackPage
    .getByRole("menuitem", { name: "Import signals", exact: true })
    .click();
  const fallbackImport = textareaFallbackPage.getByRole("dialog", {
    name: "Import IR signals",
  });
  assert.equal(
    await fallbackImport.locator('input[type="file"]').getAttribute("tabindex"),
    "-1",
    "The visually hidden file input must not add an invisible keyboard stop",
  );
  const fallbackTextarea = fallbackImport.getByLabel("Signal data", {
    exact: true,
  });
  assert.equal(
    await fallbackImport.locator("ha-textarea").count(),
    0,
    "Undefined optional ha-textarea should not be rendered",
  );
  assert.equal(
    await fallbackTextarea.evaluate((element) => element.localName),
    "textarea",
  );
  await fallbackTextarea.fill("+9000 -4500");
  assert.equal(await fallbackTextarea.inputValue(), "+9000 -4500");
  await fallbackImport
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await textareaFallbackPage
    .getByRole("button", { name: "Create custom signal", exact: true })
    .last()
    .click();
  await textareaFallbackPage
    .getByRole("heading", { name: "Signal Lab", exact: true })
    .waitFor();
  assert.equal(
    await textareaFallbackPage.getByText(/^New custom signal ·/).count(),
    1,
  );
  assert.equal(
    await textareaFallbackPage
      .getByRole("button", { name: "Save as new command", exact: true })
      .count(),
    1,
  );
  assert.match(textareaFallbackPage.url(), /workspace=signal-lab/);
  assert.match(textareaFallbackPage.url(), /custom=1/);
  await textareaFallbackPage.close();
  await open("load-error");
  assert.equal(
    await page.getByRole("alert").count(),
    1,
    "Load failures should use Home Assistant alert semantics",
  );
  assert.equal(errors.length, 0, `Browser errors: ${errors.join("\n")}`);
  console.log("Browser smoke checks passed.");
} finally {
  await browser.close();
  await server.close();
}
