/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscodel10n = require("@vscode/l10n-dev");
const { execFileSync } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const logger = require("./terminal-logger");
const { writeJsonAndFormat, writeAndFormat } = require("./file-utils");

/**
 * Extension configuration mapping
 * Maps extension directory names to their XLIFF file names
 */
const EXTENSION_CONFIG = {
    mssql: "vscode-mssql",
    "sql-database-projects": "sql-database-projects",
    "data-workspace": "data-workspace",
};

const EXTENSION_INPUTS = {
    mssql: ["extensions/mssql/src/", "extensions/mssql/package.nls.json"],
    "sql-database-projects": [
        "extensions/sql-database-projects/src/",
        "extensions/sql-database-projects/package.nls.json",
    ],
    "data-workspace": [
        "extensions/data-workspace/src/",
        "extensions/data-workspace/package.nls.json",
    ],
};

const LOCALIZATION_SCRIPT_INPUTS = [
    "scripts/localization-extract.js",
    "scripts/file-utils.js",
    "scripts/terminal-logger.js",
];

function getStagedFiles() {
    const output = execFileSync(
        "git",
        ["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-z"],
        { encoding: "buffer" },
    );

    return output
        .toString("utf8")
        .split("\0")
        .map((file) => file.replace(/\\/g, "/").trim())
        .filter(Boolean);
}

function matchesInput(file, input) {
    return input.endsWith("/") ? file.startsWith(input) : file === input;
}

function getAffectedExtensionsForPrecommit() {
    const stagedFiles = getStagedFiles();

    if (stagedFiles.some((file) => LOCALIZATION_SCRIPT_INPUTS.includes(file))) {
        return Object.keys(EXTENSION_CONFIG);
    }

    return Object.entries(EXTENSION_INPUTS)
        .filter(([, inputs]) =>
            stagedFiles.some((file) => inputs.some((input) => matchesInput(file, input))),
        )
        .map(([extension]) => extension);
}

/**
 * Scans the src directory of an extension for TypeScript files and extracts their content
 * @param {string} extensionPath - Path to the extension directory
 * @returns {Promise<Object>} L10n JSON object containing localization data
 */
async function getL10nJson(extensionPath) {
    logger.step("Scanning source files for localization strings...");

    try {
        const srcPath = path.join(extensionPath, "src");
        // Read all files in src directory recursively
        const srcFiles = await fs.readdir(srcPath, { recursive: true });
        const tsFiles = srcFiles.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

        logger.info(`Found ${tsFiles.length} TypeScript files to process`);

        const fileContents = [];
        let processedFiles = 0;

        // Process each TypeScript file
        for (const file of tsFiles) {
            try {
                const filePath = path.resolve(srcPath, file);
                const content = await fs.readFile(filePath, "utf8");

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

        logger.success(`Successfully processed ${processedFiles} source files`);
        logger.step("Extracting localization strings from source code...");

        // Extract L10n data using vscode l10n tools
        const result = await vscodel10n.getL10nJson(
            fileContents.map((f) => ({
                contents: f.contents,
                extension: f.extension,
            })),
        );

        const stringCount = Object.keys(result).length;
        logger.success(`Extracted ${stringCount} localization strings`);

        return result;
    } catch (error) {
        logger.error(`Failed to extract L10n JSON: ${error.message}`);
        throw error;
    }
}

/**
 * Extracts localization strings for a single extension
 * @param {string} extensionDir - Extension directory name
 * @param {string} xliffName - Name for the XLIFF file
 */
async function extractLocalizationForExtension(extensionDir, xliffName) {
    logger.header(`Processing Extension: ${extensionDir}`);

    const extensionPath = path.resolve("extensions", extensionDir);

    try {
        // Get localization data from source files
        const bundleJSON = await getL10nJson(extensionPath);

        logger.step("Loading package localization data...");

        // Create map with package and bundle localization data
        const map = new Map();

        try {
            const packageNlsPath = path.join(extensionPath, "package.nls.json");
            const packageNlsContent = await fs.readFile(packageNlsPath, "utf8");
            map.set("package", JSON.parse(packageNlsContent));
            logger.success("Loaded package.nls.json");
        } catch (error) {
            logger.warning(`Could not load package.nls.json: ${error.message}`);
            map.set("package", {});
        }

        map.set("bundle", bundleJSON);

        // Ensure output directories exist
        const extensionL10nDir = path.join(extensionPath, "l10n");
        await fs.mkdir(extensionL10nDir, { recursive: true });
        await fs.mkdir("localization/xliff", { recursive: true });

        // Write bundle L10n JSON file to extension's l10n directory
        logger.step("Writing bundle localization file...");
        const bundlePath = path.join(extensionL10nDir, "bundle.l10n.json");
        const formatted1 = await writeJsonAndFormat(bundlePath, bundleJSON);
        if (formatted1) {
            logger.success(`Created and formatted ${bundlePath}`);
        } else {
            logger.warning(`Created ${bundlePath} (formatting failed)`);
        }

        // Generate XLIFF file for translators
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

        for (const [extensionDir, xliffName] of extensions) {
            await extractLocalizationForExtension(extensionDir, xliffName);
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

async function extractLocalizationForPrecommit() {
    const affectedExtensions = getAffectedExtensionsForPrecommit();
    if (!affectedExtensions.length) {
        console.log("No staged localization inputs; skipping localization extraction.");
        return;
    }

    for (const extensionDir of affectedExtensions) {
        await extractLocalizationForExtension(extensionDir, EXTENSION_CONFIG[extensionDir]);
    }
}

module.exports = {
    extractLocalizationStrings,
    extractLocalizationForExtension,
    extractLocalizationForPrecommit,
    getL10nJson,
};

if (require.main === module) {
    // Check if a specific extension is requested via command line args
    const args = process.argv.slice(2);
    const precommit = args.includes("--precommit");
    const specificExtension = args.find((arg) => !arg.startsWith("--"));

    if (precommit) {
        extractLocalizationForPrecommit()
            .then(() => {
                logger.success("Script completed successfully!");
                process.exit(0);
            })
            .catch((error) => {
                logger.error(`Script failed: ${error.message}`);
                process.exit(1);
            });
    } else if (specificExtension) {
        // Extract for specific extension
        const xliffName = EXTENSION_CONFIG[specificExtension];
        if (!xliffName) {
            logger.error(
                `Unknown extension: ${specificExtension}. Available extensions: ${Object.keys(EXTENSION_CONFIG).join(", ")}`,
            );
            process.exit(1);
        }

        extractLocalizationForExtension(specificExtension, xliffName)
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
