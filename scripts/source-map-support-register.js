// @ts-check
"use strict";

/*
 * Registers source-map-support so runtime error stack traces from compiled test
 * `.js` files are remapped back to their original TypeScript sources, and emits the
 * remapped paths as absolute `file://` URIs.
 *
 * Shared by every extension's `.vscode-test.mjs` (wired in through `createMochaConfig`).
 *
 * Two problems make the plain `source-map-support/register` entry point insufficient:
 *
 *   1. The VS Code extension test host reports compiled `.js` stack frames using paths
 *      relative to the working directory (the extension root), so source-map-support
 *      resolves the original `sources` relative to that base.
 *
 *   2. Even once the resolved `.ts` path is absolute, Mocha's `stackTraceFilter`
 *      (lib/runner.js) rewrites each stack frame by stripping the leading
 *      `process.cwd()` prefix, turning the absolute path back into one relative to the
 *      extension root (e.g. `test/unit/foo.test.ts`). The Extension Test Runner then
 *      resolves that relative path against the workspace root, landing on the wrong
 *      folder (`<root>/test/unit/...` instead of `<root>/extensions/<ext>/test/unit/...`).
 *
 * Emitting the source as an absolute `file://` URI solves both: the URI is absolute,
 * and Mocha's filter (which only matches a literal filesystem-path prefix) leaves it
 * untouched. The Extension Test Runner detects the `file:` scheme and parses it as an
 * absolute URI, opening the correct TypeScript file.
 */

const fs = require("fs");
const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");

// This helper lives in the shared workspace `scripts/` directory, but `source-map-support`
// is installed per-extension (the monorepo does not hoist dependencies to the root). Resolve
// it from the extension under test (the test runner's working directory) instead of from this
// file's location so the shared helper works for every extension.
const sourceMapSupport = require(require.resolve("source-map-support", { paths: [process.cwd()] }));

/**
 * Convert a stack-frame source reference to a filesystem path.
 * @param {string} source
 * @returns {string}
 */
function toFsPath(source) {
    if (source.startsWith("file://")) {
        try {
            return fileURLToPath(source);
        } catch {
            return source;
        }
    }
    return source;
}

sourceMapSupport.install({
    environment: "node",
    handleUncaughtExceptions: false,
    retrieveSourceMap(source) {
        const absoluteJsPath = path.resolve(toFsPath(source));
        const mapPath = `${absoluteJsPath}.map`;

        let contents;
        try {
            contents = fs.readFileSync(mapPath, "utf8");
        } catch {
            // No sibling map file; let the built-in handlers (inline maps, etc.) run.
            return null;
        }

        return {
            // An absolute `file://` base makes source-map-support resolve the map's
            // `sources` to absolute `file://` URIs. These survive Mocha's stack filter
            // and are parsed as absolute paths by the Extension Test Runner.
            url: pathToFileURL(absoluteJsPath).href,
            map: contents,
        };
    },
});
