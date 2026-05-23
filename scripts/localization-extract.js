/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscodel10n = require("@vscode/l10n-dev");
const fs = require("fs").promises;
const path = require("path");
const logger = require("./terminal-logger");
const { writeJsonAndFormat, writeAndFormat } = require("./file-utils");

/**
 * Extension configuration mapping
 * Maps extension directory names to their XLIFF file names and localization source files.
 */
const EXTENSION_CONFIG = {
    mssql: {
        xliffName: "vscode-mssql",
        sourceFiles: ["src/constants/locConstants.ts", "src/webviews/common/locConstants.ts"],
    },
    "sql-database-projects": {
        xliffName: "sql-database-projects",
        sourceFiles: ["src/common/constants.ts"],
    },
    "data-workspace": {
        xliffName: "data-workspace",
        sourceFiles: [],
    },
};

async function getL10nJsonFromFileContents(fileContents) {
    logger.step("Extracting localization strings from source code...");

    const result = await vscodel10n.getL10nJson(
        fileContents.map((f) => ({
            contents: f.contents,
            extension: f.extension,
        })),
    );

    const stringCount = Object.keys(result).length;
    logger.success(`Extracted ${stringCount} localization strings`);

    return result;
}

/**
 * Reads configured localization source files for an extension and extracts their content.
 * @param {string} extensionPath - Path to the extension directory
 * @param {string[]} sourceFiles - Localization source files relative to the extension directory
 * @param {(filePath: string) => Promise<string> | string} readSourceFile - Reads a source file
 * @returns {Promise<Object>} L10n JSON object containing localization data
 */
async function getL10nJson(extensionPath, sourceFiles, readSourceFile = fs.readFile) {
    logger.step("Reading localization source files...");

    try {
        logger.info(`Found ${sourceFiles.length} localization source files to process`);

        const fileContents = [];
        let processedFiles = 0;

        for (const file of sourceFiles) {
            try {
                const filePath = path.resolve(extensionPath, file);
                const content = await readSourceFile(filePath, "utf8");

                if (content) {
                    fileContents.push({
                        contents: content,
                        extension: file.endsWith(".tsx") ? ".tsx" : ".ts",
                    });
                    processedFiles++;
                }
            } catch (error) {
                logger.warning(`Failed to read file ${file}: ${error.message}`);
            }
        }

        logger.success(`Successfully processed ${processedFiles} localization source files`);
        return await getL10nJsonFromFileContents(fileContents);
    } catch (error) {
        logger.error(`Failed to extract L10n JSON: ${error.message}`);
        throw error;
    }
}

function getExtensionPath(extensionDir) {
    return path.resolve("extensions", extensionDir);
}

async function writeLocalizationOutputs(extensionDir, xliffName, packageJSON, bundleJSON) {
    const map = new Map();
    map.set("package", packageJSON);
    map.set("bundle", bundleJSON);

    const extensionPath = path.resolve("extensions", extensionDir);
    const extensionL10nDir = path.join(extensionPath, "l10n");
    await fs.mkdir(extensionL10nDir, { recursive: true });
    await fs.mkdir("localization/xliff", { recursive: true });

    logger.step("Writing bundle localization file...");
    const bundlePath = path.join(extensionL10nDir, "bundle.l10n.json");
    const formatted1 = await writeJsonAndFormat(bundlePath, bundleJSON);
    if (formatted1) {
        logger.success(`Created and formatted ${bundlePath}`);
    } else {
        logger.warning(`Created ${bundlePath} (formatting failed)`);
    }

    logger.step("Generating XLIFF file for translation...");
    const stringXLIFF = vscodel10n.getL10nXlf(map);
    const xliffPath = `localization/xliff/${xliffName}.xlf`;
    const formatted2 = await writeAndFormat(
        xliffPath,
        stringXLIFF,
        false, // We don't want to run prettier on XLIFF files
        true, // Use CRLF line endings to match .gitattributes
    );
    if (formatted2) {
        logger.success(`Created ${xliffPath}`);
    } else {
        logger.warning(`Created ${xliffPath} (formatting failed)`);
    }

    return [bundlePath.replace(/\\/g, "/"), xliffPath];
}

/**
 * Extracts localization strings for a single extension
 * @param {string} extensionDir - Extension directory name
 * @param {string} xliffName - Name for the XLIFF file
 */
async function extractLocalizationForExtension(extensionDir, xliffName) {
    logger.header(`Processing Extension: ${extensionDir}`);

    const extensionPath = getExtensionPath(extensionDir);

    try {
        const bundleJSON = await getL10nJson(
            extensionPath,
            EXTENSION_CONFIG[extensionDir].sourceFiles,
        );

        logger.step("Loading package localization data...");

        let packageJSON;
        try {
            const packageNlsPath = path.join(extensionPath, "package.nls.json");
            const packageNlsContent = await fs.readFile(packageNlsPath, "utf8");
            packageJSON = JSON.parse(packageNlsContent);
            logger.success("Loaded package.nls.json");
        } catch (error) {
            logger.warning(`Could not load package.nls.json: ${error.message}`);
            packageJSON = {};
        }

        await writeLocalizationOutputs(extensionDir, xliffName, packageJSON, bundleJSON);

        logger.success(`Localization extraction for ${extensionDir} completed successfully!`);
        logger.newline();
    } catch (error) {
        logger.error(`Localization extraction for ${extensionDir} failed: ${error.message}`);
        throw error;
    }
}

/**
 * Extracts localization strings from all configured extensions
 * Generates English language l10n and XLIFF files for translation in the root localization directory
 */
async function extractLocalizationStrings() {
    logger.header("Localization String Extraction - All Extensions");
    logger.step("Starting localization string extraction process");
    logger.newline();

    try {
        const extensions = Object.entries(EXTENSION_CONFIG);

        for (const [extensionDir, config] of extensions) {
            await extractLocalizationForExtension(extensionDir, config.xliffName);
        }

        logger.header("All Extensions Processed Successfully");
        logger.success(
            `Extracted localization for ${extensions.length} extension(s) to root localization/`,
        );
    } catch (error) {
        logger.error(`Localization extraction failed: ${error.message}`);
        throw error;
    }
}

module.exports = {
    extractLocalizationStrings,
    extractLocalizationForExtension,
    getL10nJson,
};

if (require.main === module) {
    // Check if a specific extension is requested via command line args
    const args = process.argv.slice(2);
    const specificExtension = args.find((arg) => !arg.startsWith("--"));

    if (specificExtension) {
        // Extract for specific extension
        const config = EXTENSION_CONFIG[specificExtension];
        if (!config) {
            logger.error(
                `Unknown extension: ${specificExtension}. Available extensions: ${Object.keys(EXTENSION_CONFIG).join(", ")}`,
            );
            process.exit(1);
        }

        extractLocalizationForExtension(specificExtension, config.xliffName)
            .then(() => {
                logger.success("Script completed successfully!");
                process.exit(0);
            })
            .catch((error) => {
                logger.error(`Script failed: ${error.message}`);
                process.exit(1);
            });
    } else {
        // Extract for all extensions
        extractLocalizationStrings()
            .then(() => {
                logger.success("Script completed successfully!");
                process.exit(0);
            })
            .catch((error) => {
                logger.error(`Script failed: ${error.message}`);
                process.exit(1);
            });
    }
}
