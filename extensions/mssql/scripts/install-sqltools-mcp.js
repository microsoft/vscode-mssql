/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");
const logger = require("../../../scripts/terminal-logger");

const extensionRoot = path.resolve(__dirname, "..");
const localPackageSourceEnvVar = "SQLTOOLS_MCP_NUPKG_DIR";

function getSqlToolsMcpConfig() {
    try {
        return require("../out/src/configurations/config").config.sqlToolsMcp;
    } catch (error) {
        throw new Error(
            "Unable to load SQL Tools MCP config. Build the extension before installing MCP payloads. " +
                error.message,
        );
    }
}

function getInstallDirectory(config, installPlatform) {
    const relativeInstallDir = config.installDir
        .replace("{#version#}", config.version)
        .replace("{#platform#}", installPlatform);
    return path.resolve(extensionRoot, relativeInstallDir);
}

function getPackageRuntimeId(config, runtime) {
    const packageRuntimeId = config.packageRuntimeIds[runtime];
    if (!packageRuntimeId) {
        throw new Error(`Unsupported SQL Tools MCP runtime: ${runtime}`);
    }
    return packageRuntimeId;
}

function getInstallPlatform(runtime, packageRuntimeId) {
    return runtime === "Portable" ? "Portable" : packageRuntimeId;
}

function getPackageFileName(config, packageRuntimeId) {
    return `${config.packageId}.${packageRuntimeId}.${config.version}.nupkg`;
}

async function findPackageFile(rootDir, fileName) {
    const expectedFileName = fileName.toLowerCase();
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === expectedFileName) {
            return entryPath;
        }

        if (entry.isDirectory()) {
            const result = await findPackageFile(entryPath, fileName);
            if (result) {
                return result;
            }
        }
    }

    return undefined;
}

async function extractPayload(nupkgPath, sourcePrefix, installDirectory) {
    await fs.promises.rm(installDirectory, { recursive: true, force: true });
    await fs.promises.mkdir(installDirectory, { recursive: true });

    await new Promise((resolve, reject) => {
        yauzl.open(nupkgPath, { lazyEntries: true }, (openError, zipFile) => {
            if (openError) {
                reject(openError);
                return;
            }

            zipFile.on("entry", (entry) => {
                if (!entry.fileName.startsWith(sourcePrefix)) {
                    zipFile.readEntry();
                    return;
                }

                const relativeEntryPath = entry.fileName.slice(sourcePrefix.length);
                if (!relativeEntryPath) {
                    zipFile.readEntry();
                    return;
                }

                const targetPath = path.resolve(
                    installDirectory,
                    relativeEntryPath.split("/").join(path.sep),
                );
                if (!targetPath.startsWith(`${installDirectory}${path.sep}`)) {
                    reject(new Error(`Invalid path in SQL Tools MCP package: ${entry.fileName}`));
                    return;
                }

                if (/\/$/.test(entry.fileName)) {
                    fs.promises
                        .mkdir(targetPath, { recursive: true })
                        .then(() => zipFile.readEntry())
                        .catch(reject);
                    return;
                }

                zipFile.openReadStream(entry, (streamError, readStream) => {
                    if (streamError) {
                        reject(streamError);
                        return;
                    }

                    fs.promises
                        .mkdir(path.dirname(targetPath), { recursive: true })
                        .then(
                            () =>
                                new Promise((streamResolve, streamReject) => {
                                    const writeStream = fs.createWriteStream(targetPath);
                                    readStream.pipe(writeStream);
                                    readStream.on("error", streamReject);
                                    writeStream.on("error", streamReject);
                                    writeStream.on("finish", streamResolve);
                                }),
                        )
                        .then(() => zipFile.readEntry())
                        .catch(reject);
                });
            });

            zipFile.on("end", resolve);
            zipFile.on("error", reject);
            zipFile.readEntry();
        });
    });
}

async function makeExecutableIfNeeded(runtime, installDirectory) {
    if (runtime === "Portable" || runtime.startsWith("Windows_")) {
        return;
    }

    const executablePath = path.join(installDirectory, "SQLtoolsMCPserver");
    await fs.promises.chmod(executablePath, 0o755);
}

async function installSqlToolsMcp(runtime) {
    const packageSourceDir = process.env[localPackageSourceEnvVar];
    if (!packageSourceDir) {
        throw new Error(
            `${localPackageSourceEnvVar} must point to downloaded SQL Tools MCP nupkgs.`,
        );
    }

    const config = getSqlToolsMcpConfig();
    const packageRuntimeId = getPackageRuntimeId(config, runtime);
    const installPlatform = getInstallPlatform(runtime, packageRuntimeId);
    const packageFileName = getPackageFileName(config, packageRuntimeId);
    const nupkgPath = await findPackageFile(packageSourceDir, packageFileName);
    if (!nupkgPath) {
        throw new Error(
            `SQL Tools MCP package was not found under ${packageSourceDir}: ${packageFileName}`,
        );
    }

    const installDirectory = getInstallDirectory(config, installPlatform);
    const sourcePrefix =
        runtime === "Portable" ? "tools/net10.0/any/" : `tools/any/${packageRuntimeId}/`;

    logger.step(`Installing SQL Tools MCP ${runtime} from ${nupkgPath}`);
    await extractPayload(nupkgPath, sourcePrefix, installDirectory);
    await makeExecutableIfNeeded(runtime, installDirectory);
    logger.success(`SQL Tools MCP installed to ${installDirectory}`);
}

async function cleanSqlToolsMcpInstallFolder() {
    const config = getSqlToolsMcpConfig();
    const rootPath = path.resolve(
        extensionRoot,
        config.installDir.replace("{#version#}", config.version).replace("{#platform#}", ""),
    );
    await fs.promises.rm(rootPath, { recursive: true, force: true });
    await fs.promises.mkdir(rootPath, { recursive: true });
}

function showHelp() {
    console.log(`
Usage:
  node scripts/install-sqltools-mcp.js --runtime <Runtime>

Runtime values:
  Portable, Windows_64, Windows_ARM64, OSX, OSX_ARM64, Linux, Linux_ARM64

Environment:
  ${localPackageSourceEnvVar}=<folder containing downloaded SQL Tools MCP nupkgs>
`);
}

async function main() {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        showHelp();
        return;
    }

    const runtimeArgIndex = process.argv.indexOf("--runtime");
    const runtime = runtimeArgIndex >= 0 ? process.argv[runtimeArgIndex + 1] : "Portable";
    await installSqlToolsMcp(runtime);
}

module.exports = {
    cleanSqlToolsMcpInstallFolder,
    installSqlToolsMcp,
};

if (require.main === module) {
    main().catch((error) => {
        logger.error(error.message);
        process.exit(1);
    });
}
