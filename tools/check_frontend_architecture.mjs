import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const frontend = join(root, "frontend");
const manifestPath = join(frontend, "core", "ha-components.ts");
const bundlePath = join(
  root,
  "custom_components",
  "imprint_refinery",
  "www",
  "imprint-refinery-card.js",
);

const walk = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
  }
  return files;
};

const walkPublicText = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkPublicText(path)));
    else if (entry.isFile() && /\.(?:html|js|mjs|md)$/.test(path)) files.push(path);
  }
  return files;
};

const files = await walk(frontend);
const sources = new Map(
  await Promise.all(
    files.map(async (path) => [path, await readFile(path, "utf8")]),
  ),
);
const combined = [...sources.values()].join("\n");
const registrations = [
  ...combined.matchAll(/safeCustomElement\(["'](imprint-[a-z0-9-]+)["']\)/g),
  ...combined.matchAll(/customElements\.define\(\s*["'](imprint-[a-z0-9-]+)["']/g),
]
  .map((match) => match[1])
  .sort();
const allowlist = [
  "imprint-refinery-card",
  "imprint-refinery-panel",
  "imprint-signal-lab",
  "imprint-signal-waveform",
  "imprint-waveform-comparison",
].sort();

assert.deepEqual(
  registrations,
  allowlist,
  `Registered Imprint elements must match the five-element allowlist. Found: ${registrations.join(", ")}`,
);

const retiredTags = [
  "imprint-appliance-card",
  "imprint-appliance-dialog",
  "imprint-appliances-workspace",
  "imprint-backup-dialog",
  "imprint-catalog-dialog",
  "imprint-command-card",
  "imprint-command-inspector",
  "imprint-confirmation-dialog",
  "imprint-custom-signal-dialog",
  "imprint-dialog",
  "imprint-edit-command-dialog",
  "imprint-feedback",
  "imprint-hardware-row",
  "imprint-import-signals-dialog",
  "imprint-infrared-hardware-workspace",
  "imprint-learn-command-dialog",
  "imprint-metric",
  "imprint-metric-grid",
  "imprint-remote-profile-card",
  "imprint-remote-profile-dialog",
  "imprint-remote-profile-workspace",
  "imprint-signal-advanced-tools",
  "imprint-signal-code-view",
  "imprint-signal-decoded-view",
  "imprint-signal-details",
  "imprint-signal-frame-editor",
  "imprint-signal-preview-dialog",
  "imprint-signal-save-dialog",
  "imprint-signal-timing-editor",
  "imprint-status",
  "imprint-workspace-empty",
  "imprint-workspace-header",
  "imprint-workspace-heading",
  "imprint-workspace-notice",
];
const retiredReferences = [];
for (const [path, source] of sources) {
  for (const tag of retiredTags) {
    if (source.includes(tag)) {
      retiredReferences.push(`${relative(root, path)}:${tag}`);
    }
  }
}
assert.deepEqual(
  retiredReferences,
  [],
  `Retired element names remain in frontend source:\n${retiredReferences.join("\n")}`,
);

const publicTextPaths = [
  join(root, "README.md"),
  join(root, "CHANGELOG.md"),
  bundlePath,
  ...(await walkPublicText(join(root, "docs"))),
  ...(await walkPublicText(join(root, "tools"))).filter(
    (path) => path !== fileURLToPath(import.meta.url),
  ),
];
const retiredPublicReferences = [];
for (const path of publicTextPaths) {
  const source = await readFile(path, "utf8");
  for (const tag of retiredTags) {
    if (source.includes(tag)) {
      retiredPublicReferences.push(`${relative(root, path)}:${tag}`);
    }
  }
}
assert.deepEqual(
  retiredPublicReferences,
  [],
  `Retired element names remain in the bundle, fixtures, or public documentation:\n${retiredPublicReferences.join("\n")}`,
);

assert.equal(
  combined.includes("ModalBehaviorController"),
  false,
  "Custom modal focus/Escape ownership must not remain around ha-dialog.",
);
assert.equal(
  combined.includes("customElements.whenDefined"),
  false,
  "Home Assistant elements must not be treated as loadable via whenDefined().",
);

const rootSource = await readFile(join(frontend, "imprint-refinery-card.ts"), "utf8");
assert.equal(
  rootSource.includes("100dvh"),
  false,
  "The shared card/panel source must not impose a viewport-height card shell.",
);

const haTags = [...new Set([...combined.matchAll(/<\/?(ha-[a-z0-9-]+)/g)].map((match) => match[1]))].sort();
const manifestSource = await readFile(manifestPath, "utf8");
const declaredHaTags = new Set(
  [...manifestSource.matchAll(/["'](ha-[a-z0-9-]+)["']/g)].map(
    (match) => match[1],
  ),
);
const undeclaredHaTags = haTags.filter((tag) => !declaredHaTags.has(tag));
assert.deepEqual(
  undeclaredHaTags,
  [],
  `HA elements missing from the dependency manifest: ${undeclaredHaTags.join(", ")}`,
);

const nativeGenericControls = [];
for (const [path, source] of sources) {
  for (const match of source.matchAll(/<(button|dialog|input|select|textarea)\b/g)) {
    nativeGenericControls.push(`${relative(root, path)}:<${match[1]}>`);
  }
}
assert.deepEqual(
  nativeGenericControls.sort(),
  [
    "frontend/components/shared/textarea.ts:<textarea>",
    "frontend/components/signal-lab/waveform.ts:<button>",
    "frontend/components/workflows/import-signals-dialog.ts:<input>",
  ].sort(),
  "Generic controls must use the declared HA component boundary. Only explicit browser-native data inputs and IR-specific spatial controls may remain native.",
);

const nativeFactMarkup = [];
for (const [path, source] of sources) {
  for (const match of source.matchAll(/<(dl|dt|dd)\b/g)) {
    nativeFactMarkup.push(`${relative(root, path)}:<${match[1]}>`);
  }
}
assert.deepEqual(
  nativeFactMarkup.sort(),
  [
    "frontend/components/shared/metric-grid.ts:<dd>",
    "frontend/components/shared/metric-grid.ts:<dl>",
    "frontend/components/shared/metric-grid.ts:<dt>",
  ].sort(),
  "Semantic fact collections must use the shared fact-grid renderer.",
);

let bundleBytes = null;
try {
  bundleBytes = (await stat(bundlePath)).size;
} catch {
  // The source-only gate may run before the first build.
}

console.log(
  JSON.stringify(
    {
      registeredImprintElements: registrations,
      haElementsUsed: haTags,
      typescriptFiles: files.length,
      generatedBundleBytes: bundleBytes,
    },
    null,
    2,
  ),
);
