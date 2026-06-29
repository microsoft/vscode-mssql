/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs");
const Module = require("module");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const sourceConfigPath = path.join(extensionRoot, "src", "configurations", "config.ts");
const compiledConfigPath = path.join(extensionRoot, "out", "src", "configurations", "config");

function loadConfigFromSource() {
    const ts = require("typescript");
    const sourceText = fs.readFileSync(sourceConfigPath, "utf8");
    const transpiled = ts.transpileModule(sourceText, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    });

    const sourceModule = new Module(sourceConfigPath, module.parent);
    sourceModule.filename = sourceConfigPath;
    sourceModule.paths = Module._nodeModulePaths(path.dirname(sourceConfigPath));
    sourceModule._compile(transpiled.outputText, sourceConfigPath);

    return sourceModule.exports.config;
}

function loadConfig() {
    try {
        return loadConfigFromSource();
    } catch (sourceError) {
        try {
            return require(compiledConfigPath).config;
        } catch (compiledError) {
            throw new Error(
                "Unable to load SQL Tools MCP config from source or compiled output. " +
                    `Source error: ${sourceError.message}. Compiled error: ${compiledError.message}`,
            );
        }
    }
}

function getSqlToolsMcpConfig() {
    const config = loadConfig();
    if (!config?.sqlToolsMcp) {
        throw new Error("SQL Tools MCP config was not found.");
    }

    return config.sqlToolsMcp;
}

function getRuntimeIds(config, args) {
    if (args.includes("--portable")) {
        return [config.packageRuntimeIds.Portable];
    }

    return Object.values(config.packageRuntimeIds).sort();
}

function getPackageSpecs(config, args = []) {
    const runtimeIds = getRuntimeIds(config, args);
    return runtimeIds.map((runtimeId) => `${config.packageId}.${runtimeId}@${config.version}`);
}

function showHelp() {
    console.log(`
Usage:
  node scripts/print-sqltools-mcp-packages.js [--portable]

Options:
  --portable  Print only the portable package. By default, all configured packages are printed.
`);
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        showHelp();
        return;
    }

    const config = getSqlToolsMcpConfig();
    for (const packageSpec of getPackageSpecs(config, args)) {
        console.log(packageSpec);
    }
}

module.exports = {
    getPackageSpecs,
    getSqlToolsMcpConfig,
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
