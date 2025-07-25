/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const logger = require("./terminal-logger");
const { typecheckPlugin } = require("@jgoz/esbuild-plugin-typecheck");
const { esbuildProblemMatcherPlugin, build, watch } = require("./esbuild-utils");
const path = require("path");

// Parse arguments
const args = process.argv.slice(2);
const isProd = args.includes("--prod") || args.includes("-p");
const isWatch = args.includes("--watch") || args.includes("-w");

// Build configuration
const config = {
    entryPoints: {
        extension: "src/extension.ts",
        serviceInstallerUtil: "src/languageService/serviceInstallerUtil.ts",
    },
    bundle: true,
    outdir: "out/extension",
    platform: "node",
    loader: {
        ".ts": "ts",
        ".js": "js",
        ".json": "json",
    },
    tsconfig: "./tsconfig.extension.json",
    plugins: [
        esbuildProblemMatcherPlugin("extension"),
        typecheckPlugin({
            buildMode: "write-output",
        })
    ],
    nodePaths: ["./node_modules"],
    sourcemap: !isProd,
    sourcesContent: false,
    metafile: !isProd,
    external: ["vscode", "vscode-mssql"],
    minify: isProd,
    format: "cjs",
};

// Main execution
async function main() {
    if (isWatch) {
        logger.header("Building extension (watch mode)");
        await watch(config);
    } else {
        logger.header(`Building extension`);
        const success = await build(config, isProd);
        process.exit(success ? 0 : 1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}
