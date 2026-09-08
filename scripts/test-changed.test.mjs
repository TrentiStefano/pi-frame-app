import assert from "node:assert/strict";
import test from "node:test";
import { createChangedTestPlan, matchCoreSpecs, matchDesktopSpecs } from "./test-changed.mjs";

const coreSpecs = [
  "apps/desktop/tests/core/composer-controls.spec.ts",
  "apps/desktop/tests/core/context-rail.spec.ts",
  "apps/desktop/tests/core/message-wrapping.spec.ts",
  "apps/desktop/tests/core/multi-window.spec.ts",
  "apps/desktop/tests/core/settings-language.spec.ts",
  "apps/desktop/tests/core/sidebar-toggle.spec.ts",
  "apps/desktop/tests/core/smoke.spec.ts",
  "apps/desktop/tests/core/voice-input.spec.ts",
  "apps/desktop/tests/live/extension-dock.spec.ts",
  "apps/desktop/tests/live/extensions.spec.ts",
];

test("matches desktop source files to specs sharing a feature token", () => {
  assert.deepEqual(matchCoreSpecs("apps/desktop/electron/voice-recognition-worker.ts", coreSpecs), [
    "apps/desktop/tests/core/voice-input.spec.ts",
  ]);
  assert.deepEqual(matchCoreSpecs("apps/desktop/src/composer-panel.tsx", coreSpecs), [
    "apps/desktop/tests/core/composer-controls.spec.ts",
  ]);
});

test("runs only a directly changed desktop spec", () => {
  const plan = createChangedTestPlan(["apps/desktop/tests/core/voice-input.spec.ts"], coreSpecs);
  assert.deepEqual(plan.map((command) => command.label), [
    "desktop build",
    "desktop core: voice-input.spec.ts",
  ]);
});

test("adds real model verification for voice runtime changes", () => {
  const plan = createChangedTestPlan(["apps/desktop/electron/voice-recognition-worker.ts"], coreSpecs);
  assert.deepEqual(plan.map((command) => command.label), [
    "prepare voice model",
    "desktop build",
    "offline voice model",
    "desktop core: voice-input.spec.ts",
  ]);
});

test("falls back to the core lane for broad desktop entry points", () => {
  const plan = createChangedTestPlan(["apps/desktop/electron/main.ts"], coreSpecs);
  assert.equal(plan.at(-1)?.label, "desktop core lane");
});

test("runs the core lane for shared Playwright helpers and config", () => {
  for (const file of [
    "apps/desktop/playwright.config.ts",
    "apps/desktop/tests/helpers/electron-app.ts",
  ]) {
    const plan = createChangedTestPlan([file], coreSpecs);
    assert.equal(plan.at(-1)?.label, "desktop core lane");
  }
});

test("runs every spec in a lane when its shared support file changes", () => {
  const plan = createChangedTestPlan(["apps/desktop/tests/live/session-event-test-helpers.ts"], coreSpecs);
  assert.deepEqual(plan.map((command) => command.label), [
    "desktop build",
    "desktop live: extension-dock.spec.ts, extensions.spec.ts",
  ]);
});

test("tests the changed selector when its implementation changes", () => {
  const plan = createChangedTestPlan(["scripts/test-changed.mjs"], coreSpecs);
  assert.deepEqual(plan.map((command) => command.label), ["node test scripts/test-changed.test.mjs"]);
});

test("routes package changes to their local checks", () => {
  const plan = createChangedTestPlan([
    "packages/pi-sdk-driver/src/index.ts",
    "packages/session-driver/src/index.ts",
  ], coreSpecs);
  assert.deepEqual(plan.map((command) => command.label), [
    "typecheck packages/session-driver",
    "pi-sdk-driver tests",
  ]);
});

test("treats root test configuration as a full default regression change", () => {
  const plan = createChangedTestPlan(["package.json"], coreSpecs);
  assert.deepEqual(plan.map((command) => command.label), [
    "pi-sdk-driver tests",
    "desktop build",
    "desktop core lane",
  ]);
});
