/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { createNodeExtensionConfig, run } = require("../../../scripts/esbuild-utils");

// Build configuration
void run(
    ({ isProd }) =>
        createNodeExtensionConfig({
            entryPoints: {
                extension: "src/extension.ts",
                serviceInstallerUtil: "src/languageservice/serviceInstallerUtil.ts",
            },
            // ssh2 (via dockerode) treats cpu-features as an optional native optimization and
            // falls back when it is unavailable. Keep the native addon out of the bundle.
            external: ["cpu-features", "vscode-mssql"],
            loader: {
                ".ts": "ts",
                ".js": "js",
                ".json": "json",
                ".node": "file",
            },
            metafile: !isProd,
            minify: isProd,
            nodePaths: ["./node_modules"],
            outdir: "dist",
            sourcemap: !isProd,
            sourcesContent: false,
            tsconfig: "./tsconfig.extension.json",
        }),
    "extension",
);
