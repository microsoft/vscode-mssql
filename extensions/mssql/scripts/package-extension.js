/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs");
const { execSync } = require("child_process");
const { promisify } = require("util");
const del = require("del");
const logger = require("../../../scripts/terminal-logger");

const args = process.argv.slice(2);
let isOnline = args.includes("--online");
const isOffline = args.includes("--offline");

// Platform configurations for offline packaging
const OFFLINE_PLATFORMS = [
    { rid: "win-x64", runtime: "Windows_64" },
    { rid: "win-arm64", runtime: "Windows_ARM64" },
    { rid: "osx", runtime: "OSX" },
    { rid: "osx-arm64", runtime: "OSX_ARM64" },
    { rid: "linux-x64", runtime: "Linux" },
    { rid: "linux-arm64", runtime: "Linux_ARM64" },
];

/**
 * Install SQL Tools Service for a specific platform
 */
async function installSqlToolsService(platform = null) {
    logger.step("Installing SQL Tools Service...");

    try {
        const install = require("../dist/serviceInstallerUtil");
        await install.installService(platform);
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
        const vsceArgs = ["yarn", "vsce", "package"];

        if (packageName) {
            vsceArgs.push("-o", packageName);
        }

        const command = vsceArgs.join(" ");
        logger.debug(`Running: ${command}`);

        execSync(command, { stdio: "inherit" });
        logger.success(`Extension packaged${packageName ? `: ${packageName}` : ""}`);
    } catch (error) {
        logger.error(`Packaging failed: ${error.message}`);
        throw error;
    }
}

/**
 * Package extension for online distribution
 */
async function packageOnline() {
    logger.header("Package extension (Online Mode)");
    logger.info("Creating extension package for online distribution");
    logger.newline();

    try {
        // Clean service folder first
        await cleanServiceInstallFolder();

        // Package the extension
        packageExtension();

        logger.newline();
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

        // Install service for this platform
        await installSqlToolsService(runtimeValue);

        // Package with platform-specific name
        const platformPackageName = `${packageName}-${rid}.vsix`;
        packageExtension(platformPackageName);

        // Clean up for next platform
        await cleanServiceInstallFolder();

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
        const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
        const packageName = `${packageJson.name}-${packageJson.version}`;

        logger.info(`Creating offline packages for: ${packageJson.name} v${packageJson.version}`);
        logger.info(`Total platforms: ${OFFLINE_PLATFORMS.length}`);
        logger.newline();

        // Clean service folder initially
        await cleanServiceInstallFolder();

        // Package for each platform sequentially
        for (let i = 0; i < OFFLINE_PLATFORMS.length; i++) {
            const platform = OFFLINE_PLATFORMS[i];
            logger.info(`[${i + 1}/${OFFLINE_PLATFORMS.length}] Processing ${platform.rid}...`);

            try {
                await packageOfflinePlatform(platform, packageName);
            } catch (error) {
                logger.warning(`Skipping ${platform.rid}: ${error.message}`);
            }

            logger.newline();
        }

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
  --online     Package for online distribution (downloads service at runtime)
  --offline    Package for offline distribution (includes service for all platforms). Defaults to online mode if no argument is provided.
  --help       Show this help message

Examples:
  node package-extension.js [--online]  # Create online package. Default behavior if none specified
  node package-extension.js --online    # Create online package
  node package-extension.js --offline   # Create offline packages for all platforms

Requirements:
  - vsce must be installed globally: npm install -g vsce
  - Extension must be built first: yarn build
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

    try {
        if (isOnline) {
            await packageOnline();
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
