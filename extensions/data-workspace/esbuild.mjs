/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuildUtils from "../../scripts/esbuild-utils.js";

const extensionDirectory = path.dirname(fileURLToPath(import.meta.url));
const { createNodeExtensionConfig, disallowUnresolvedModulesPlugin, run } = esbuildUtils;
const outputFile = path.join(extensionDirectory, "dist/main.js");

/**
 * Bundle the TypeScript entry point and its runtime dependencies into dist/main.js so VSCE can
 * package the extension with --no-dependencies. Imports of package.json and package.vscode.json
 * are written relative to their source files, so the resolver below redirects them to this
 * extension's manifests after esbuild changes the module layout. azdata remains external because
 * @microsoft/ads-extension-telemetry probes for it optionally at runtime. The unresolved-module
 * guard prevents declaration-only extension APIs from leaking into the runtime bundle.
 */
const extensionManifestPlugin = {
    name: "extension-manifest",
    setup(build) {
        build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/package(?:\.vscode)?\.json$/ }, (args) => ({
            path: path.join(extensionDirectory, path.basename(args.path)),
        }));
    },
};

await run(
    ({ isProd }) =>
        createNodeExtensionConfig({
            entryPoints: {
                main: path.join(extensionDirectory, "src/main.ts"),
            },
            external: ["azdata"],
            outdir: path.join(extensionDirectory, "dist"),
            minify: isProd,
            plugins: [
                extensionManifestPlugin,
                disallowUnresolvedModulesPlugin(outputFile, ["dataworkspace", "vscode-mssql"]),
            ],
            sourcemap: !isProd,
            tsconfig: path.join(extensionDirectory, "tsconfig.json"),
        }),
    "Data Workspace extension",
);
