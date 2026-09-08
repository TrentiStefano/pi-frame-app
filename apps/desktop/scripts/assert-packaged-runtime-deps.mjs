import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { constants, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { computerUsePackageName, computerUseVersion } from "./desktop-package-metadata.mjs";

const requiredPackages = [
  // Keep packaging-sensitive runtime transitive deps explicit; electron-builder
  // can omit hoisted pnpm dependencies even when local development resolves them.
  "@anthropic-ai/sdk",
  "@aws-crypto/sha256-browser",
  "@aws-crypto/sha256-js",
  "@aws-sdk/client-bedrock-runtime",
  "@aws-sdk/core",
  "@aws-sdk/credential-provider-node",
  "@aws-sdk/eventstream-handler-node",
  "@aws-sdk/middleware-eventstream",
  "@aws-sdk/middleware-websocket",
  "@aws-sdk/nested-clients",
  "@aws-sdk/signature-v4-multi-region",
  "@aws-sdk/token-providers",
  "@aws-sdk/types",
  "@aws-sdk/xml-builder",
  "@aws/lambda-invoke-store",
  "@earendil-works/chord",
  "@google/genai",
  "@injaneity/pi-computer-use",
  "@mistralai/mistralai",
  "@modelcontextprotocol/sdk",
  "@opentelemetry/api",
  "@silvia-odwyer/photon-node",
  "@smithy/core",
  "@smithy/credential-provider-imds",
  "@smithy/fetch-http-handler",
  "@smithy/is-array-buffer",
  "@smithy/node-http-handler",
  "@smithy/property-provider",
  "@smithy/shared-ini-file-loader",
  "@smithy/signature-v4",
  "@smithy/types",
  "@smithy/util-buffer-from",
  "@smithy/util-utf8",
  "@xterm/addon-clipboard",
  "@xterm/addon-fit",
  "@xterm/addon-web-links",
  "@xterm/xterm",
  "ansi-regex",
  "balanced-match",
  "bowser",
  "brace-expansion",
  "chalk",
  "cross-spawn",
  "data-uri-to-buffer",
  "diff",
  "electron-updater",
  "glob",
  "highlight.js",
  "hosted-git-info",
  "http-proxy-agent",
  "https-proxy-agent",
  "ignore",
  "jiti",
  "lru-cache",
  "mime-types",
  "minimatch",
  "node-pty",
  "openai",
  "parse5",
  "parse5-htmlparser2-tree-adapter",
  "path-key",
  "partial-json",
  "proper-lockfile",
  "proxy-agent",
  "retry",
  "semver",
  "shebang-command",
  "sherpa-onnx-node",
  "strip-ansi",
  "tslib",
  "typebox",
  "undici",
  "which",
  "yaml",
  "yargs",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const packagePlatform = (process.env.PI_APP_PACKAGE_PLATFORM ?? process.platform).trim().toLowerCase();
const releaseDir = path.resolve(desktopDir, process.env.PI_APP_TEST_RELEASE_DIR?.trim() || "release");
const asarPath = resolveAsarPath(releaseDir, packagePlatform);
// This native helper filename is historical and remains stable for notification upgrade compatibility.
const notificationHelperPath =
  packagePlatform === "darwin"
    ? path.join(releaseDir, "mac-arm64", resolveAppBundleName(releaseDir), "Contents", "MacOS", "pi-gui-notification-status-helper")
    : undefined;
const pnpmBinary = process.platform === "win32" ? process.execPath : "pnpm";
const pnpmArgs = process.platform === "win32"
  ? [path.resolve(desktopDir, "..", "..", "node_modules", "pnpm", "bin", "pnpm.cjs")]
  : [];
const piCodingAgentPackageName = "@earendil-works/pi-coding-agent";
const requiredPiCodingAgentVersion = "0.81.1";
const voiceModelFiles = [
  ["voice-model/sherpa-onnx-paraformer-zh-2023-09-14/model.int8.onnx", 243_371_218, "f36a0433bcf096bd6d6f11b80a3ac8bed110bdca632fe0d731df8d1a84475945"],
  ["voice-model/sherpa-onnx-paraformer-zh-2023-09-14/tokens.txt", 75_756, "59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6"],
  ["voice-model/sherpa-onnx-paraformer-zh-2023-09-14/test_wavs/0.wav", 179_712, "1a6bf94091d9c35e11aea5d494d05e3287b8f5c767f6de3bfd796d91b637500c"],
];
const modelChecks = [
  ...["luna", "sol", "terra"].map((variant) => ({
    provider: "openai-codex",
    id: `gpt-5.6-${variant}`,
    reason: "GPT 5.6 Codex support",
    requireReasoning: true,
    requireImageInput: true,
    requireMaxThinking: true,
  })),
  {
    provider: "anthropic",
    id: "claude-opus-4-7",
    reason: "issue #12 Opus 4.7 visibility",
    requireReasoning: true,
    requireImageInput: true,
  },
  {
    provider: "zai",
    id: "glm-5.1",
    reason: "issue #12 GLM 5.1 visibility",
    requireReasoning: true,
    requireImageInput: false,
  },
];
// These are package subpath specifiers, not filesystem paths. In particular, the
// MCP package exports ./client (and its wildcard subpaths) from dist/esm; its
// package root does not contain client/index.js at the package root.
const packagedRuntimeImportChecks = [
  { specifier: "@earendil-works/chord", resolveWithExports: true },
  { specifier: "@earendil-works/chord/context", resolveWithExports: true },
  { specifier: "@earendil-works/pi-ai/dist/providers/google.js", resolveWithExports: false },
  { specifier: "@earendil-works/pi-ai/dist/bedrock-provider.js", resolveWithExports: false },
  { specifier: "proxy-agent/dist/index.js", resolveWithExports: false },
  { specifier: "@modelcontextprotocol/sdk/client/index.js", resolveWithExports: true },
  { specifier: "@modelcontextprotocol/sdk/client/streamableHttp.js", resolveWithExports: true },
  { specifier: "@modelcontextprotocol/sdk/client/stdio.js", resolveWithExports: true },
];

if (!existsSync(asarPath)) {
  throw new Error(`Packaged app.asar not found at ${asarPath}. Run the packaging step first.`);
}

const packagedResourcesDir = path.dirname(asarPath);
if (notificationHelperPath && !existsSync(notificationHelperPath)) {
  throw new Error(`Packaged app is missing notification helper: ${notificationHelperPath}`);
}

if (packagePlatform === "win32") {
  const windowsPackageRoot = path.dirname(path.dirname(asarPath));
  // Windows must not carry the macOS helper (historical filename retained only on macOS).
  const unexpectedNotificationHelper = findFileNamed(windowsPackageRoot, "pi-gui-notification-status-helper");
  if (unexpectedNotificationHelper) {
    throw new Error(`Packaged Windows app contains the macOS notification helper: ${unexpectedNotificationHelper}`);
  }
}

const extractedDir = mkdtempSync(path.join(tmpdir(), "pi-frame-packaged-runtime-"));
try {
  execFileSync(pnpmBinary, [...pnpmArgs, "exec", "asar", "extract", asarPath, extractedDir], {
    cwd: desktopDir,
    stdio: "pipe",
  });

  verifyRequiredPackages(extractedDir);
  verifyPackagedVoiceModel(packagedResourcesDir);
  verifyPackagedComputerUse(extractedDir, packagedResourcesDir);
  verifyPackagedThirdPartyNotices(packagedResourcesDir);
  await verifyPackagedPiRuntime(extractedDir);
  await verifyPackagedRuntimeImports(extractedDir);
  await verifyNativeNodePty(asarPath);
  verifyNativeSherpa(asarPath);
} finally {
  try {
    rmSync(extractedDir, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: process.platform === "win32" ? 200 : 0,
    });
  } catch (error) {
    if (process.platform === "win32") {
      console.warn(`Warning: could not remove temp dir ${extractedDir}: ${error.message}`);
    } else {
      throw error;
    }
  }
}

console.log(`Verified packaged runtime dependencies in ${asarPath}`);

function verifyPackagedVoiceModel(resourcesDir) {
  for (const [relativePath, expectedSize, expectedHash] of voiceModelFiles) {
    const filePath = path.join(resourcesDir, relativePath);
    if (!existsSync(filePath)) throw new Error(`Packaged voice asset is missing: ${filePath}`);
    const stat = readFileSync(filePath);
    const actualHash = createHash("sha256").update(stat).digest("hex");
    if (stat.byteLength !== expectedSize || actualHash !== expectedHash) {
      throw new Error(`Packaged voice asset mismatch: ${filePath} (${stat.byteLength} bytes, ${actualHash})`);
    }
  }
}

function resolveAppBundleName(releaseDir) {
  const macDir = path.join(releaseDir, "mac-arm64");
  const bundle = readdirSync(macDir, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (!bundle) throw new Error(`Packaged macOS app bundle not found under ${macDir}`);
  return bundle.name;
}

function resolveAsarPath(releaseDir, packagePlatform) {
  if (packagePlatform === "darwin") {
    return path.join(releaseDir, "mac-arm64", resolveAppBundleName(releaseDir), "Contents", "Resources", "app.asar");
  }

  if (packagePlatform === "linux") {
    const unpackedAsarPath = readdirSync(releaseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^linux(?:-[\w]+)?-unpacked$/.test(entry.name))
      .map((entry) => path.join(releaseDir, entry.name, "resources", "app.asar"))
      .find((candidatePath) => existsSync(candidatePath));

    if (unpackedAsarPath) {
      return unpackedAsarPath;
    }

    return path.join(releaseDir, "linux-unpacked", "resources", "app.asar");
  }

  if (packagePlatform === "win32") {
    const unpackedAsarPath = readdirSync(releaseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^win(?:-[\w]+)?-unpacked$/.test(entry.name))
      .map((entry) => path.join(releaseDir, entry.name, "resources", "app.asar"))
      .find((candidatePath) => existsSync(candidatePath));

    if (unpackedAsarPath) {
      return unpackedAsarPath;
    }

    return path.join(releaseDir, "win-unpacked", "resources", "app.asar");
  }

  throw new Error(`Unsupported packaged runtime dependency target: ${packagePlatform}`);
}

function verifyRequiredPackages(extractedDir) {
  const missingPackages = requiredPackages.filter(
    (packageName) => !existsSync(path.join(extractedDir, "node_modules", packageName)),
  );

  if (missingPackages.length > 0) {
    throw new Error(`Packaged app is missing runtime dependencies: ${missingPackages.join(", ")}`);
  }
}

async function verifyPackagedPiRuntime(extractedDir) {
  const packageJsonPath = path.join(extractedDir, "node_modules", ...piCodingAgentPackageName.split("/"), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (packageJson.version !== requiredPiCodingAgentVersion) {
    throw new Error(
      `Packaged app has ${piCodingAgentPackageName} ${packageJson.version}; expected ${requiredPiCodingAgentVersion}.`,
    );
  }

  const runtimeEntry = path.join(extractedDir, "node_modules", ...piCodingAgentPackageName.split("/"), "dist", "index.js");
  const { ModelRuntime } = await import(pathToFileURL(runtimeEntry).href);
  const runtime = await ModelRuntime.create({ modelsPath: null });
  const models = runtime.getModels();
  for (const check of modelChecks) {
    const model = models.find((entry) => entry.provider === check.provider && entry.id === check.id);
    const modelKey = `${check.provider}/${check.id}`;
    if (!model) {
      throw new Error(`Packaged Pi runtime does not expose ${modelKey} for ${check.reason}.`);
    }
    if (check.requireReasoning && !model.reasoning) {
      throw new Error(`Packaged ${modelKey} is missing reasoning support for ${check.reason}.`);
    }
    if (check.requireImageInput && !model.input.includes("image")) {
      throw new Error(`Packaged ${modelKey} is missing image input support for ${check.reason}.`);
    }
    if (check.requireMaxThinking && model.thinkingLevelMap?.max !== "max") {
      throw new Error(`Packaged ${modelKey} is missing max thinking support for ${check.reason}.`);
    }
  }
}

async function verifyPackagedRuntimeImports(extractedDir) {
  // Resolve through the extracted tree's package exports. Directly appending a
  // subpath to node_modules bypasses exports and breaks pnpm production trees.
  const packageJsonUrl = pathToFileURL(path.join(extractedDir, "package.json")).href;
  const requireFromPackage = createRequire(path.join(extractedDir, "package.json"));
  for (const { specifier, resolveWithExports } of packagedRuntimeImportChecks) {
    let runtimeEntry;
    try {
      if (resolveWithExports) {
        try {
          const resolvedUrl = import.meta.resolve(specifier, packageJsonUrl);
          runtimeEntry = fileURLToPath(resolvedUrl);
        } catch {
          runtimeEntry = requireFromPackage.resolve(specifier);
        }
      } else {
        runtimeEntry = requireFromPackage.resolve(specifier);
      }
    } catch (error) {
      if (resolveWithExports) {
        throw new Error(`Packaged runtime export cannot be resolved: ${specifier}: ${error.message}`);
      }
      // These legacy checks intentionally validate files that are not package
      // exports (pi-ai and proxy-agent expose these paths to the bundle).
      runtimeEntry = path.join(extractedDir, "node_modules", ...specifier.split("/"));
      if (!existsSync(runtimeEntry)) {
        throw new Error(`Packaged runtime file cannot be resolved: ${specifier}: ${error.message}`);
      }
    }
    await import(pathToFileURL(runtimeEntry).href);
  }
}

async function verifyNativeNodePty(asarPath) {
  const unpackedResourcesDir = `${asarPath}.unpacked`;
  const nodePtyDir = path.join(unpackedResourcesDir, "node_modules", "node-pty");
  if (!existsSync(nodePtyDir) || !hasFileWithExtension(nodePtyDir, ".node")) {
    throw new Error(`Packaged app is missing unpacked node-pty native module under ${nodePtyDir}`);
  }
  if (packagePlatform !== "darwin") {
    return;
  }
  const helperPath = findFileNamed(nodePtyDir, "spawn-helper");
  if (!helperPath) {
    throw new Error(`Packaged app is missing unpacked node-pty spawn-helper under ${nodePtyDir}`);
  }
  await access(helperPath, constants.X_OK);
}

function verifyPackagedComputerUse(extractedDir, resourcesDir) {
  const packageRoot = path.join(extractedDir, "node_modules", ...computerUsePackageName.split("/"));
  const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (packageJson.version !== computerUseVersion) {
    throw new Error(
      `Packaged app has ${computerUsePackageName} ${packageJson.version}; expected ${computerUseVersion}.`,
    );
  }

  const requiredFiles = [
    path.join(packageRoot, "scripts", "setup-helper.mjs"),
    path.join(resourcesDir, "third-party", "THIRD_PARTY_NOTICES.txt"),
    path.join(resourcesDir, "third-party", "licenses", "pi-computer-use-0.5.0", "LICENSE"),
  ];
  if (packagePlatform === "win32") {
    requiredFiles.push(path.join(resourcesDir, "computer-use", "windows-bridge.exe"));
  }
  const missingFiles = requiredFiles.filter((filePath) => !existsSync(filePath));
  if (missingFiles.length > 0) {
    throw new Error(`Packaged Computer Use runtime is incomplete: ${missingFiles.join(", ")}`);
  }
}

function verifyPackagedThirdPartyNotices(resourcesDir) {
  const notices = path.join(resourcesDir, "third-party", "THIRD_PARTY_NOTICES.txt");
  if (!existsSync(notices) || !readFileSync(notices, "utf8").includes("pi-computer-use")) {
    throw new Error(`Packaged app is missing retained third-party notices: ${notices}`);
  }
}

function verifyNativeSherpa(asarPath) {
  const platformPackage = resolveSherpaPlatformPackage();
  const nativeDir = path.join(`${asarPath}.unpacked`, "node_modules", platformPackage);
  const requiredFiles =
    packagePlatform === "win32"
      ? [
          "sherpa-onnx.node",
          "onnxruntime.dll",
          "onnxruntime_providers_shared.dll",
          "sherpa-onnx-c-api.dll",
          "sherpa-onnx-cxx-api.dll",
        ]
      : ["sherpa-onnx.node"];
  const missingFiles = requiredFiles.filter((fileName) => !existsSync(path.join(nativeDir, fileName)));
  if (missingFiles.length > 0) {
    throw new Error(
      `Packaged app is missing unpacked ${platformPackage} runtime files: ${missingFiles.join(", ")}`,
    );
  }
}

function resolveSherpaPlatformPackage() {
  if (packagePlatform === "win32") {
    return "sherpa-onnx-win-x64";
  }
  if (packagePlatform === "darwin") {
    return "sherpa-onnx-darwin-arm64";
  }
  if (packagePlatform === "linux") {
    return `sherpa-onnx-linux-${process.arch}`;
  }
  throw new Error(`Unsupported sherpa-onnx package platform: ${packagePlatform}`);
}

function hasFileWithExtension(directoryPath, extension) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name.endsWith(extension)) {
      return true;
    }
    if (entry.isDirectory() && hasFileWithExtension(entryPath, extension)) {
      return true;
    }
  }
  return false;
}

function findFileNamed(directoryPath, fileName) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nestedMatch = findFileNamed(entryPath, fileName);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }
  return undefined;
}
