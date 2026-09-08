import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeNextVersion, updateVersionInFiles } from "./auto-version.mjs";

test("computeNextVersion increments beta counter in prerelease", () => {
  assert.equal(computeNextVersion("0.2.0-beta.5", "feat: new feature"), "0.2.0-beta.6");
  assert.equal(computeNextVersion("0.2.0-beta.5", "fix(chat): bug fix"), "0.2.0-beta.6");
  assert.equal(computeNextVersion("0.2.0-beta.5", "chore: cleanup"), "0.2.0-beta.6");
  assert.equal(computeNextVersion("0.2.0-beta.5", "feat!: breaking change"), "0.3.0-beta.1");
});

test("computeNextVersion follows SemVer on stable release", () => {
  assert.equal(computeNextVersion("1.0.0", "feat: add capability"), "1.1.0");
  assert.equal(computeNextVersion("1.0.0", "fix: resolve race"), "1.0.1");
  assert.equal(computeNextVersion("1.0.0", "perf: speedup query"), "1.0.1");
  assert.equal(computeNextVersion("1.0.0", "feat!: breaking change"), "2.0.0");
  assert.equal(computeNextVersion("1.0.0", "fix: critical\n\nBREAKING CHANGE: api altered"), "2.0.0");
});

test("updateVersionInFiles synchronizes package.json files and README badge", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-frame-ver-test-"));
  try {
    const pkg = { name: "pi-frame", version: "0.2.0-beta.5" };
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    fs.writeFileSync(path.join(tmp, "README.md"), "[![Version](https://img.shields.io/badge/version-0.2.0--beta.5-orange.svg)](./apps/desktop/package.json)\n");

    fs.mkdirSync(path.join(tmp, "apps", "desktop"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "apps", "desktop", "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    fs.mkdirSync(path.join(tmp, "apps", "website"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "apps", "website", "package.json"), JSON.stringify(pkg, null, 2) + "\n");

    updateVersionInFiles(tmp, "0.2.0-beta.5", "0.2.0-beta.6");

    const rootPkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
    const desktopPkg = JSON.parse(fs.readFileSync(path.join(tmp, "apps", "desktop", "package.json"), "utf8"));
    const websitePkg = JSON.parse(fs.readFileSync(path.join(tmp, "apps", "website", "package.json"), "utf8"));
    const readme = fs.readFileSync(path.join(tmp, "README.md"), "utf8");

    assert.equal(rootPkg.version, "0.2.0-beta.6");
    assert.equal(desktopPkg.version, "0.2.0-beta.6");
    assert.equal(websitePkg.version, "0.2.0-beta.6");
    assert.equal(readme.includes("version-0.2.0--beta.6-orange"), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
