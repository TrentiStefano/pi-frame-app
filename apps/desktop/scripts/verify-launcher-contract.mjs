import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { run, spawnProcess } from "./launcher.mjs";

const require = createRequire(import.meta.url);
const { augmentMacPath } = require("./augment-path.cjs");

function verifyPathContract() {
  const windowsPath = "C:\\Windows;C:\\Windows\\System32";
  const windowsResult = augmentMacPath({
    platform: "win32",
    env: { PATH: windowsPath, HOME: undefined },
  });
  assert.equal(windowsResult.changed, true);
  assert.equal(windowsResult.path.includes("Git\\cmd"), true);
  assert.equal(windowsResult.path.includes("nodejs"), true);

  const windowsQuotedPath = "C:\\Windows;'C:\\Tools\\Python;\"C:\\Program Files\\app\"";
  const windowsQuotedResult = augmentMacPath({
    platform: "win32",
    env: { PATH: windowsQuotedPath, HOME: undefined },
  });
  assert.equal(windowsQuotedResult.changed, true);
  assert.equal(windowsQuotedResult.path.includes("'"), false);
  assert.equal(windowsQuotedResult.path.includes('"'), false);
  assert.equal(windowsQuotedResult.path.includes("C:\\Tools\\Python"), true);

  const linuxResult = augmentMacPath({
    platform: "linux",
    env: { PATH: "/usr/bin", HOME: "/home/pi" },
    delimiter: ":",
  });
  assert.deepEqual(linuxResult, { changed: false, path: "/usr/bin" });

  const macResult = augmentMacPath({
    platform: "darwin",
    env: { PATH: "/usr/bin", HOME: "/Users/pi" },
    delimiter: ":",
  });
  assert.equal(macResult.changed, true);
  assert.deepEqual(macResult.path.split(":"), [
    "/usr/local/bin",
    "/Users/pi/.npm-global/bin",
    "/usr/bin",
  ]);

  const noHomeResult = augmentMacPath({
    platform: "darwin",
    env: { PATH: "/usr/bin", HOME: undefined },
    delimiter: ":",
  });
  assert.equal(noHomeResult.path.includes("undefined"), false);

  const idempotentResult = augmentMacPath({
    platform: "darwin",
    env: {
      PATH: "/usr/local/bin:/Users/pi/.npm-global/bin:/usr/bin",
      HOME: "/Users/pi",
    },
    delimiter: ":",
  });
  assert.equal(idempotentResult.changed, false);

  console.log("ok - application PATH contract");
}

const forwardedArgv = [
  "--remoteDebuggingPort",
  "9222",
  "--flag=value with spaces",
  "a b c",
  "a&b",
  "*.ts",
  'quote"inside',
];

function writeArgvEchoScript(directory) {
  const scriptPath = path.join(directory, "echo-argv.mjs");
  writeFileSync(
    scriptPath,
    [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync(process.env.ARGV_OUT, JSON.stringify(process.argv.slice(2)));",
      "",
    ].join("\n"),
  );
  return scriptPath;
}

function writeShim(directory, marker) {
  if (process.platform === "win32") {
    const shimPath = path.join(directory, "pi-launch-shim.cmd");
    writeFileSync(shimPath, `@echo off\r\necho ${marker}\r\n`);
    return;
  }

  const shimPath = path.join(directory, "pi-launch-shim");
  writeFileSync(shimPath, `#!/bin/sh\necho ${marker}\n`);
  chmodSync(shimPath, 0o755);
}

function captureStdout(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}

async function verifyLauncherContract() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "pi gui launcher "));
  const workingDirectory = path.join(temporaryRoot, "work dir");
  mkdirSync(workingDirectory, { recursive: true });
  const warnings = [];
  const onWarning = (warning) => warnings.push(warning);
  process.on("warning", onWarning);

  try {
    const argvOutput = path.join(workingDirectory, "argv.json");
    const echoScript = writeArgvEchoScript(workingDirectory);
    process.env.ARGV_OUT = argvOutput;
    try {
      await run(process.execPath, [echoScript, ...forwardedArgv], workingDirectory);
    } finally {
      delete process.env.ARGV_OUT;
    }
    assert.deepEqual(JSON.parse(readFileSync(argvOutput, "utf8")), forwardedArgv);
    console.log("ok - argv preserved from a path containing spaces");

    const marker = "pi-launch-shim-ok";
    writeShim(workingDirectory, marker);
    const shimOutput = await captureStdout("pi-launch-shim", [], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        PATH: `${workingDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    assert.equal(shimOutput.includes(marker), true);
    console.log("ok - command shim resolves without ENOENT");

    const shellSpawnWarning = warnings.find(
      (warning) => warning?.code === "DEP0190" || /DEP0190/.test(String(warning?.message)),
    );
    assert.equal(shellSpawnWarning, undefined);
    console.log("ok - no shell-spawn deprecation warning");
  } finally {
    process.off("warning", onWarning);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

verifyPathContract();
await verifyLauncherContract();
console.log("Verified dev launcher argv/PATH contract");
