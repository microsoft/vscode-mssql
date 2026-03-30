/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs");
const { execFileSync } = require("child_process");
const { promisify } = require("util");
const del = require("del");
const logger = require("../../../scripts/terminal-logger");
const path = require("path");

const args = process.argv.slice(2);
let isOnline = args.includes("--online");
const isOffline = args.includes("--offline");
const skipServiceInstall = args.includes("--skip-service-install");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

// Platform configurations for offline packaging
const OFFLINE_PLATFORMS = [
    { rid: "win-x64", runtime: "Windows_64" },
    { rid: "win-arm64", runtime: "Windows_ARM64" },
    { rid: "osx", runtime: "OSX" },
    { rid: "osx-arm64", runtime: "OSX_ARM64" },
    { rid: "linux-x64", runtime: "Linux" },
    { rid: "linux-arm64", runtime: "Linux_ARM64" },
];

const RUNTIME_EXTENSION_ID = "ms-dotnettools.vscode-dotnet-runtime";
const PACKAGE_JSON_PATH = path.resolve(__dirname, "..", "package.json");

function readPackageJson() {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
}

function writePackageJson(packageJson) {
    fs.writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 4)}\n`, "utf8");
}

/**
 * For offline packaging, we need to remove dependency on the runtime extension since we are including the self-contained STS.
 * This is done as users might not have access to the marketplace to download the runtime extension when they install the vsix,
 * so we need to make sure the extension can work without it. We will restore the original package.json after packaging is done.
 */
async function withOfflinePackageManifest(action) {
    const originalPackageJson = fs.readFileSync(PACKAGE_JSON_PATH, "utf8");
    const packageJson = JSON.parse(originalPackageJson);

    packageJson.extensionDependencies = (packageJson.extensionDependencies || []).filter(
        (extensionId) => extensionId !== RUNTIME_EXTENSION_ID,
    );
    packageJson.extensionPack = (packageJson.extensionPack || []).filter(
        (extensionId) => extensionId !== RUNTIME_EXTENSION_ID,
    );

    writePackageJson(packageJson);

    try {
        return await action();
    } finally {
        fs.writeFileSync(PACKAGE_JSON_PATH, originalPackageJson, "utf8");
    }
}

/**
 * Install SQL Tools Service for a specific platform after cleaning the install folder.
 */
async function installSqlToolsService(platform) {
    logger.step("Installing SQL Tools Service...");

    try {
        const install = require("../dist/serviceInstallerUtil");
        await install.cleanAndInstallService(platform);
        logger.success("SQL Tools Service installed");
    } catch (error) {
        logger.error(`Failed to install SQL Tools Service: ${error.message}`);
        throw error;
    }
}

/**
 * Clean the service install folder
 */
async function cleanServiceInstallFolder() {
    logger.step("Cleaning service install folder...");

    try {
        const install = require("../dist/serviceInstallerUtil");
        const serviceInstallFolder = install.getServiceInstallDirectoryRoot();

        logger.debug(`Deleting: ${serviceInstallFolder}`);
        await del(serviceInstallFolder + "/*");
        logger.success("Service install folder cleaned");
    } catch (error) {
        logger.error(`Failed to clean service folder: ${error.message}`);
        throw error;
    }
}

/**
 * Package extension using vsce
 */
function packageExtension(packageName = null) {
    logger.step("Packaging extension with vsce...");

    try {
        const vsceArgs = ["exec", "--", "vsce", "package", "--no-dependencies"];

        if (packageName) {
            vsceArgs.push("-o", packageName);
        }

        logger.debug(`Running: ${npmCommand} ${vsceArgs.join(" ")}`);

        execFileSync(npmCommand, vsceArgs, { stdio: "inherit" });
        logger.success(`Extension packaged${packageName ? `: ${packageName}` : ""}`);
    } catch (error) {
        logger.error(`Packaging failed: ${error.message}`);
        throw error;
    }
}

/**
 * Package extension for online distribution
 */
async function packageOnline(options = {}) {
    const { skipServiceInstall = false } = options;

    logger.header("Package extension (Online Mode)");
    logger.info("Creating extension package with portable SQL Tools Service");
    try {
        if (skipServiceInstall) {
            logger.info(
                "Skipping SQL Tools Service install and using existing service files in the install folder",
            );
        } else {
            // Download portable (framework-dependent) SQL Tools Service
            const platform = require("../out/src/models/platform");
            await installSqlToolsService(platform.Runtime.Portable);
        }
        // Package the extension
        packageExtension();
        logger.success("Online packaging completed successfully!");
    } catch (error) {
        logger.error(`Online packaging failed: ${error.message}`);
        throw error;
    }
}

/**
 * Package extension for a specific platform (offline)
 */
async function packageOfflinePlatform(platformConfig, packageName) {
    const { rid, runtime } = platformConfig;

    logger.step(`Packaging for ${rid}...`);

    try {
        // Get the runtime constant
        const platform = require("../out/src/models/platform");
        const runtimeValue = platform.Runtime[runtime];
        if (!runtimeValue) {
            throw new Error(`Unknown runtime: ${runtime}`);
        }
        // Install native (self-contained) service for this platform
        await installSqlToolsService(runtimeValue);
        // Package with platform-specific name
        const platformPackageName = `${packageName}-${rid}.vsix`;
        packageExtension(platformPackageName);
        logger.success(`${rid} package created`);
    } catch (error) {
        logger.error(`Failed to package ${rid}: ${error.message}`);
        throw error;
    }
}

/**
 * Package extension for offline distribution (all platforms)
 */
async function packageOffline() {
    logger.header("Package extension (Offline Mode)");

    try {
        // Read package.json for name and version
        const packageJson = readPackageJson();
        const packageName = `${packageJson.name}-${packageJson.version}`;

        logger.info(`Creating offline packages for: ${packageJson.name} v${packageJson.version}`);
        logger.info(`Total platforms: ${OFFLINE_PLATFORMS.length}`);

        await withOfflinePackageManifest(async () => {
            // Clean service folder initially
            await cleanServiceInstallFolder();

            // Package for each platform sequentially with native (self-contained) service
            for (let i = 0; i < OFFLINE_PLATFORMS.length; i++) {
                const platformConfig = OFFLINE_PLATFORMS[i];
                logger.info(
                    `[${i + 1}/${OFFLINE_PLATFORMS.length}] Processing ${platformConfig.rid}...`,
                );

                try {
                    await packageOfflinePlatform(platformConfig, packageName);
                } catch (error) {
                    logger.warning(`Skipping ${platformConfig.rid}: ${error.message}`);
                }

                logger.newline();
            }
        });

        logger.success("Offline packaging completed for all platforms!");
    } catch (error) {
        logger.error(`Offline packaging failed: ${error.message}`);
        throw error;
    }
}

/**
 * Show help information
 */
function showHelp() {
    console.log(`
Extension Packaging Script

Usage:
  node package-extension.js [mode]

Modes:
  --online     Package with portable SQL Tools Service (requires dotnet runtime at runtime). Default if not specified.
  --offline    Package with native self-contained SQL Tools Service for each platform (no dotnet needed).
    --skip-service-install  Online mode only. Reuse existing SQL Tools Service files and skip clean/install.
  --help       Show this help message

Examples:
  node package-extension.js [--online]  # Create online package. Default behavior if none specified
  node package-extension.js --online    # Create online package
    node package-extension.js --online --skip-service-install  # Package online using existing service files
  node package-extension.js --offline   # Create offline packages for all platforms

Requirements:
    - Install workspace dependencies from the repository root: npm ci
    - Extension must be built first: npm run build -- --target mssql
`);
}

/**
 * Main execution function
 */
async function main() {
    // Show help
    if (args.includes("--help") || args.includes("-h")) {
        showHelp();
        process.exit(0);
    }

    // Validate arguments
    if (!isOnline && !isOffline) {
        isOnline = true; // Default to online mode if no argument provided
        logger.info("No mode specified, defaulting to online packaging");
    }

    if (isOnline && isOffline) {
        logger.error("Cannot specify both --online and --offline modes");
        process.exit(1);
    }

    if (skipServiceInstall && isOffline) {
        logger.error("--skip-service-install can only be used with --online mode");
        process.exit(1);
    }

    try {
        if (isOnline) {
            await packageOnline({ skipServiceInstall });
        } else if (isOffline) {
            await packageOffline();
        }

        logger.success("Packaging script completed successfully!");
        process.exit(0);
    } catch (error) {
        logger.error(`Packaging script failed: ${error.message}`);
        process.exit(1);
    }
}

// Export functions for programmatic use
module.exports = {
    packageOnline,
    packageOffline,
    installSqlToolsService,
    cleanServiceInstallFolder,
    packageExtension,
};

// Run if called directly
if (require.main === module) {
    main();
}
