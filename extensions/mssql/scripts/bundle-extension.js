/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { createNodeExtensionConfig, run } = require("../../../scripts/esbuild-utils");
const { tediousStreamingPlpDecodePlugin } = require("./tedious-streaming-plp-decode-plugin");

void run(
    ({ isProd }) =>
        createNodeExtensionConfig({
            entryPoints: {
                extension: "src/extension.ts",
                serviceInstallerUtil: "src/languageservice/serviceInstallerUtil.ts",
                // Vector Workbench analysis worker (VEC-4): its own node
                // bundle so the service can spawn it in worker_threads.
                vectorAnalysisWorker: "src/queryResults/vector/vectorAnalysisWorker.ts",
                // No-VS-Code, no-model deterministic preview runner. This is
                // an explicit fake lane, not the future production Activity Host.
                runbookHeadless: "src/runbookStudio/headless/headlessCli.ts",
                // Lazy ts-native provider chunk: never part of the activation
                // graph, loaded only after this backend is selected.
                tsNativeProvider: "src/services/tsNative/providerEntry.ts",
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
            plugins: [tediousStreamingPlpDecodePlugin()],
            sourcemap: !isProd,
            sourcesContent: false,
            tsconfig: "./tsconfig.extension.json",
        }),
    "extension",
);
