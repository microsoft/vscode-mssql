/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs").promises;
const path = require("path");
const { createBrowserConfig, run } = require("../../../scripts/esbuild-utils");
const webviewEntryPoints = require("./webview-entry-points.json");

function verifyWebviewBundleOutputsPlugin() {
    return {
        name: "verify-webview-bundle-outputs",
        setup(build) {
            build.onEnd(async (result) => {
                if (result.errors.length > 0) {
                    return;
                }

                const outdir = build.initialOptions.outdir;
                const outputFiles = new Set(await fs.readdir(path.resolve(outdir)));
                const expectedOutputs = Object.keys(webviewEntryPoints).flatMap((bundleName) => [
                    `${bundleName}.js`,
                    `${bundleName}.css`,
                ]);
                const missingOutputs = expectedOutputs.filter((output) => !outputFiles.has(output));

                if (missingOutputs.length > 0) {
                    result.errors.push({
                        text: `Missing expected webview bundle output(s): ${missingOutputs.sort().join(", ")}`,
                    });
                }
            });
        },
    };
}

// Build configuration
void run(
    ({ isProd }) =>
        createBrowserConfig({
            entryPoints: webviewEntryPoints,
            loader: {
                ".tsx": "tsx",
                ".ts": "ts",
                ".css": "css",
                ".svg": "file",
                ".js": "js",
                ".png": "file",
                ".gif": "file",
            },
            metafile: !isProd,
            minify: isProd,
            outdir: "dist/views",
            plugins: [verifyWebviewBundleOutputsPlugin()],
            sourcemap: isProd ? false : "inline",
            splitting: true,
            tsconfig: "./tsconfig.webviews.json",
        }),
    "webviews",
);
