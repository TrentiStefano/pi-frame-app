import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const [readme, siteMetadata, websitePage] = await Promise.all([
    readFile(path.join(repoRoot, "README.md"), "utf8"),
    readFile(path.join(repoRoot, "apps", "website", "app", "site.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps", "website", "app", "page.tsx"), "utf8"),
  ]);
  assert.match(readme, /pnpm install/);
  assert.match(readme, /pnpm package:win/);
  assert.match(readme, /pnpm package:mac/);
  assert.match(readme, /pnpm package:linux/);
  assert.match(siteMetadata, /pi-frame/);
  assert.match(siteMetadata, /GitHub Releases/);
  assert.match(websitePage, /Download Beta/);
  assert.match(websitePage, /pnpm install/);
  assert.match(websitePage, /pnpm dev/);
  assert.doesNotMatch(websitePage, /Homebrew|brew install|brew upgrade/);
  process.stdout.write("Install copy matches the pnpm and GitHub Releases contract.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
