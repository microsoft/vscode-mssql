/**
 * Patches @vscode/test-electron to fix a bug where Windows insiders archive ZIPs
 * are extracted with their top-level commit-hash directory preserved (e.g.
 * `69eb462356/resources/app/`), while `insidersDownloadDirMetadata` expects the
 * contents to be directly under the cache folder (i.e. `resources/app/product.json`).
 *
 * This causes the insiders version check to always fail on Windows (product.json is
 * never found → version falls back to 'unknown' → currentHash !== latestHash →
 * VS Code is re-downloaded on every test run).
 *
 * Root cause: the ZIP extraction path uses `stripComponents = 0` for non-server
 * Windows archives, while the tarball path (used on macOS/Linux) correctly uses
 * `stripComponents = 1` for all non-CLI platforms.  Making them consistent fixes
 * the caching.
 *
 * Upstream: https://github.com/microsoft/vscode-test/issues (file if not already reported)
 * Remove this script once @vscode/test-electron is updated with the fix.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const downloadJsPath = resolve(__dirname, "../node_modules/@vscode/test-electron/out/download.js");

const BROKEN = `const stripComponents = (0, util_2.isPlatformServer)(platform) ? 1 : 0;`;
const FIXED = `const stripComponents = (0, util_2.isPlatformCLI)(platform) ? 0 : 1; // patched: strip top-level dir from Windows archives (same as tgz behavior)`;

let content;
try {
    content = readFileSync(downloadJsPath, "utf-8");
} catch {
    console.warn("[patch-vscode-test-electron] Could not read download.js — skipping patch.");
    process.exit(0);
}

if (content.includes(FIXED)) {
    console.log("[patch-vscode-test-electron] Already patched — skipping.");
    process.exit(0);
}

if (!content.includes(BROKEN)) {
    console.warn(
        "[patch-vscode-test-electron] Expected line not found in download.js.\n" +
            "The upstream package may have been updated. Please review and remove this patch script if the fix is included.",
    );
    process.exit(0);
}

writeFileSync(downloadJsPath, content.replace(BROKEN, FIXED), "utf-8");
console.log(
    "[patch-vscode-test-electron] Patched download.js: stripComponents now strips the top-level directory from Windows archive ZIPs.",
);
