/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const logger = require("../../../scripts/terminal-logger");
const { esbuildProblemMatcherPlugin, build, watch } = require("./esbuild-utils");

// Parse arguments
const args = process.argv.slice(2);
const isProd = args.includes("--prod") || args.includes("-p");
const isWatch = args.includes("--watch") || args.includes("-w");

// Bundles the headless Cloud Deploy CLI into one self-contained file so a CI
// runner can execute it with a single `node mssql-validate.cjs run-gates …`,
// with no install step. `vscode` is marked external as a safety net — the
// engine never imports it, so the bundle must never reach for it at runtime —
// and `msnodesqlv8` (the optional native SQL driver) stays external because the
// CLI uses tedious, the pure-JS transport.
const config = {
    entryPoints: {
        "mssql-validate": "src/cloudDeploy/cli/runGates.ts",
    },
    bundle: true,
    outdir: "dist/cloud-deploy-cli",
    outExtension: { ".js": ".cjs" },
    platform: "node",
    format: "cjs",
    loader: {
        ".ts": "ts",
        ".js": "js",
        ".json": "json",
        ".node": "file",
    },
    tsconfig: "./tsconfig.extension.json",
    plugins: [esbuildProblemMatcherPlugin("cloud-deploy-cli")],
    nodePaths: ["./node_modules"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: !isProd,
    sourcesContent: false,
    external: ["vscode", "vscode-mssql", "msnodesqlv8"],
    minify: isProd,
};

async function main() {
    if (isWatch) {
        logger.header("Bundling Cloud Deploy CLI (watch mode)");
        await watch(config);
    } else {
        logger.header("Bundling Cloud Deploy CLI");
        const success = await build(config, isProd);
        process.exit(success ? 0 : 1);
    }
}

if (require.main === module) {
    main();
}
