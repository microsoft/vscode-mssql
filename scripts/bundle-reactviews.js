/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const logger = require("./terminal-logger");
const { esbuildProblemMatcherPlugin, build, watch } = require("./esbuild-utils");

// Parse arguments
const args = process.argv.slice(2);
const isProd = args.includes("--prod") || args.includes("-p");
const isWatch = args.includes("--watch") || args.includes("-w");

// Build configuration
const config = {
    entryPoints: {
        addFirewallRule: "src/reactviews/pages/AddFirewallRule/index.tsx",
        connectionDialog: "src/reactviews/pages/ConnectionDialog/index.tsx",
        connectionGroup: "src/reactviews/pages/ConnectionGroup/index.tsx",
        DacpacDialog: "src/reactviews/pages/DacpacDialog/index.tsx",
        deployment: "src/reactviews/pages/Deployment/index.tsx",
        executionPlan: "src/reactviews/pages/ExecutionPlan/index.tsx",
        tableDesigner: "src/reactviews/pages/TableDesigner/index.tsx",
        objectExplorerFilter: "src/reactviews/pages/ObjectExplorerFilter/index.tsx",
        queryResult: "src/reactviews/pages/QueryResult/index.tsx",
        userSurvey: "src/reactviews/pages/UserSurvey/index.tsx",
        schemaDesigner: "src/reactviews/pages/SchemaDesigner/index.tsx",
        schemaCompare: "src/reactviews/pages/SchemaCompare/index.tsx",
        changePassword: "src/reactviews/pages/ChangePassword/index.tsx",
        publishProject: "src/reactviews/pages/PublishProject/index.tsx",
        tableExplorer: "src/reactviews/pages/TableExplorer/index.tsx",
    },
    bundle: true,
    outdir: "dist/views",
    platform: "browser",
    loader: {
        ".tsx": "tsx",
        ".ts": "ts",
        ".css": "css",
        ".svg": "file",
        ".js": "js",
        ".png": "file",
        ".gif": "file",
    },
    tsconfig: "./tsconfig.react.json",
    plugins: [esbuildProblemMatcherPlugin("webviews")],
    sourcemap: isProd ? false : "inline",
    metafile: !isProd,
    minify: isProd,
    format: "esm",
    splitting: true,
};

// Main execution
async function main() {
    if (isWatch) {
        logger.header("Building webviews (watch mode)");
        await watch(config);
    } else {
        logger.header(`Building webviews`);
        const success = await build(config, isProd);
        process.exit(success ? 0 : 1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}
