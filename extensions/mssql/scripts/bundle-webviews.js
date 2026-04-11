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

// Build configuration
const config = {
    entryPoints: {
        addFirewallRule: "src/webviews/pages/AddFirewallRule/index.tsx",
        backupDatabaseDialog:
            "src/webviews/pages/ObjectManagement/BackupDatabase/backupDatabaseIndex.tsx",
        restoreDatabaseDialog:
            "src/webviews/pages/ObjectManagement/RestoreDatabase/restoreDatabaseIndex.tsx",
        connectionDialog: "src/webviews/pages/ConnectionDialog/index.tsx",
        connectionGroup: "src/webviews/pages/ConnectionGroup/index.tsx",
        DacpacDialog: "src/webviews/pages/DacpacDialog/index.tsx",
        deployment: "src/webviews/pages/Deployment/index.tsx",
        executionPlan: "src/webviews/pages/ExecutionPlan/index.tsx",
        flatFileImport: "src/webviews/pages/FlatFileImport/index.tsx",
        tableDesigner: "src/webviews/pages/TableDesigner/index.tsx",
        objectExplorerFilter: "src/webviews/pages/ObjectExplorerFilter/index.tsx",
        queryResult: "src/webviews/pages/QueryResult/index.tsx",
        userSurvey: "src/webviews/pages/UserSurvey/index.tsx",
        schemaDesigner: "src/webviews/pages/SchemaDesigner/index.tsx",
        schemaCompare: "src/webviews/pages/SchemaCompare/index.tsx",
        changePassword: "src/webviews/pages/ChangePassword/index.tsx",
        createDatabaseDialog: "src/webviews/pages/ObjectManagement/createDatabaseIndex.tsx",
        dropDatabaseDialog: "src/webviews/pages/ObjectManagement/dropDatabaseIndex.tsx",
        publishProject: "src/webviews/pages/PublishProject/index.tsx",
        codeAnalysis: "src/webviews/pages/CodeAnalysis/index.tsx",
        tableExplorer: "src/webviews/pages/TableExplorer/index.tsx",
        searchDatabase: "src/webviews/pages/SearchDatabase/index.tsx",
        changelog: "src/webviews/pages/Changelog/index.tsx",
        profiler: "src/webviews/pages/Profiler/index.tsx",
        azureDataStudioMigration: "src/webviews/pages/AzureDataStudioMigration/index.tsx",
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
    tsconfig: "./tsconfig.webviews.json",
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
