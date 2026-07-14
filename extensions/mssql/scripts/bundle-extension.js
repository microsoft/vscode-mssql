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
            external: ["vscode-mssql"],
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
