/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { createNodeExtensionConfig, run } = require("../../../scripts/esbuild-utils");
const { tediousStreamingPlpDecodePlugin } = require("./tedious-streaming-plp-decode-plugin");
const logger = require("../../../scripts/terminal-logger");
const { channelExclusionPlugin, resolveBuildChannel } = require("./build-channels");

// Build channel: --channel=<name> or MSSQL_BUILD_CHANNEL; defaults to
// "development" (everything included). Excluded non-production areas are
// stubbed out of the bundle entirely — see src/nonproduction/README.md.
const buildChannel = resolveBuildChannel();
logger.info(`Build channel: ${buildChannel}`);

// Build configuration
void run(
    ({ isProd }) =>
        createNodeExtensionConfig({
            entryPoints: {
                extension: "src/extension.ts",
                // Loaded only when the Native TypeScript provider is selected.
                tsNativeProvider: "src/services/tsNative/providerEntry.ts",
                serviceInstallerUtil: "src/languageservice/serviceInstallerUtil.ts",
            },
            external: ["vscode-mssql"],
            loader: {
                ".ts": "ts",
                ".js": "js",
                ".json": "json",
                ".node": "file",
            },
            define: {
                "process.env.MSSQL_BUILD_CHANNEL": JSON.stringify(buildChannel),
            },
            metafile: true,
            minify: isProd,
            nodePaths: ["./node_modules"],
            outdir: "dist",
            plugins: [channelExclusionPlugin(buildChannel), tediousStreamingPlpDecodePlugin()],
            sourcemap: !isProd,
            sourcesContent: false,
            tsconfig: "./tsconfig.extension.json",
        }),
    "extension",
);
