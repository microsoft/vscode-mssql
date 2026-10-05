/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuildUtils from "../../scripts/esbuild-utils.js";

const extensionDirectory = path.dirname(fileURLToPath(import.meta.url));
const { createNodeExtensionConfig, disallowUnresolvedModulesPlugin, run } = esbuildUtils;
const outputFile = path.join(extensionDirectory, "dist/extension.js");

/**
 * Bundle the TypeScript entry point and its runtime dependencies into dist/extension.js so VSCE
 * can package the extension with --no-dependencies. Runtime behavior lives in vscode-mssql; this
 * bundle only supplies the activation shell required for this extension's manifest contributions.
 */
await run(
    ({ isProd }) =>
        createNodeExtensionConfig({
            entryPoints: {
                extension: path.join(extensionDirectory, "src/extension.ts"),
            },
            outdir: path.join(extensionDirectory, "dist"),
            minify: isProd,
            plugins: [disallowUnresolvedModulesPlugin(outputFile, [])],
            sourcemap: !isProd,
            tsconfig: path.join(extensionDirectory, "tsconfig.extension.json"),
        }),
    "SQL Database Projects extension",
);
