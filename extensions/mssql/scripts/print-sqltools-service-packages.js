/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { loadConfig } = require("./print-sqltools-mcp-packages");

const packagePrefix = "Microsoft.SqlTools.ServiceLayer-";

function getSqlToolsServiceConfig() {
    const config = loadConfig();
    if (!config?.service) {
        throw new Error("SQL Tools Service config was not found.");
    }

    return config.service;
}

function getPackageNames(config) {
    return Object.values(config.downloadFileNames)
        .map((fileName) => `${packagePrefix}${fileName}`)
        .sort();
}

function showHelp() {
    console.log(`
Usage:
  node scripts/print-sqltools-service-packages.js [--version]

Options:
  --version  Print the configured SQL Tools Service version instead of package names.
`);
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        showHelp();
        return;
    }

    const config = getSqlToolsServiceConfig();
    if (args.includes("--version")) {
        console.log(config.version);
        return;
    }

    for (const packageName of getPackageNames(config)) {
        console.log(packageName);
    }
}

module.exports = {
    getPackageNames,
    getSqlToolsServiceConfig,
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
