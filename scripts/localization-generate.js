/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscodel10n = require("@vscode/l10n-dev");
const fs = require("fs").promises;
const path = require("path");
const logger = equire("../../../scripts/terminal-logger");
const { writeJsonAndFormat } = require("./file-utils");

/**
 * Generates runtime localization files for a single extension from root localization directory
 * @param {string} xliffPrefix - Prefix for XLIFF files (e.g., 'vscode-mssql', 'sql-database-projects')
 * @param {string} extensionPath - Path to extension directory (relative to root or absolute)
 */
async function generateRuntimeLocalizationForExtension(xliffPrefix, extensionPath) {
    logger.header(`Generating Runtime Localization: ${xliffPrefix}`);

    // Resolve paths - support both relative and absolute extension paths
    const resolvedExtensionPath = path.isAbsolute(extensionPath)
        ? extensionPath
        : path.resolve(process.cwd(), extensionPath);

    // Read from root localization directory
    const rootPath = path.resolve(__dirname, "..");
    const xliffDir = path.join(rootPath, "localization", "xliff");

    try {
        // Read all XLIFF files from root localization directory that match this extension's prefix
        let allXliffFiles;
        try {
            allXliffFiles = await fs.readdir(xliffDir);
        } catch (error) {
            logger.error(`No root localization directory found: ${xliffDir}`);
            return { processed: 0, generated: 0 };
        }

        // Filter for files matching this extension's prefix
        const xliffFiles = allXliffFiles.filter(
            (f) => f.startsWith(xliffPrefix) && f.endsWith(".xlf"),
        );

        if (xliffFiles.length === 0) {
            logger.warning(`No XLIFF files found for prefix: ${xliffPrefix}`);
            return { processed: 0, generated: 0 };
        }

        logger.info(`Found ${xliffFiles.length} XLIFF files to process for ${xliffPrefix}`);

        let processedLanguages = 0;
        let generatedFiles = 0;

        // Set up output directories in extension
        const l10nDir = path.join(resolvedExtensionPath, "l10n");
        const packageDir = resolvedExtensionPath;

        // Ensure output directories exist
        await fs.mkdir(l10nDir, { recursive: true });

        // Process each XLIFF file (except the source file)
        for (const xliffFile of xliffFiles) {
            // Skip the source XLIFF file (English template)
            if (xliffFile === `${xliffPrefix}.xlf`) {
                logger.debug(`Skipping source file: ${xliffFile}`);
                continue;
            }

            logger.step(`Processing language file: ${xliffFile}`);

            try {
                // Read XLIFF file content
                const xliffFilePath = path.join(xliffDir, xliffFile);
                const xliffFileContents = await fs.readFile(xliffFilePath, "utf8");

                // Parse XLIFF and extract localization data
                const l10nDetailsArrayFromXlf =
                    await vscodel10n.getL10nFilesFromXlf(xliffFileContents);

                // Process each localization entry
                for (const fileContent of l10nDetailsArrayFromXlf) {
                    if (fileContent.name === "bundle") {
                        // Generate bundle localization file
                        let fileName = `bundle.l10n.${fileContent.language}.json`;

                        // English uses default filename without language code
                        if (fileContent.language === "enu") {
                            fileName = "bundle.l10n.json";
                        }

                        const filePath = path.join(l10nDir, fileName);
                        const formatted = await writeJsonAndFormat(filePath, fileContent.messages);
                        if (formatted) {
                            logger.success(`Created and formatted bundle file: ${fileName}`);
                        } else {
                            logger.warning(`Created bundle file: ${fileName} (formatting failed)`);
                        }
                        generatedFiles++;
                    } else if (fileContent.name === "package") {
                        // Skip English package files (manually maintained)
                        if (fileContent.language === "enu") {
                            logger.debug("Skipping English package file (manually maintained)");
                            continue;
                        }

                        // Generate package localization file
                        const fileName = `package.nls.${fileContent.language}.json`;
                        const filePath = path.join(packageDir, fileName);
                        const formatted = await writeJsonAndFormat(filePath, fileContent.messages);
                        if (formatted) {
                            logger.success(`Created and formatted package file: ${fileName}`);
                        } else {
                            logger.warning(`Created package file: ${fileName} (formatting failed)`);
                        }
                        generatedFiles++;
                    }
                }

                processedLanguages++;
            } catch (error) {
                logger.error(`Failed to process ${xliffFile}: ${error.message}`);
            }
        }

        logger.success(`Runtime localization generation for ${xliffPrefix} completed!`);
        logger.info(
            `Summary: Processed ${processedLanguages} languages, generated ${generatedFiles} files`,
        );

        return { processed: processedLanguages, generated: generatedFiles };
    } catch (error) {
        logger.error(`Runtime localization generation failed: ${error.message}`);
        throw error;
    }
}

module.exports = {
    generateRuntimeLocalizationForExtension,
};

if (require.main === module) {
    // Require xliffPrefix and extensionPath as command line arguments
    const xliffPrefix = process.argv[2];
    const extensionPath = process.argv[3] || ".";

    if (!xliffPrefix) {
        logger.error("Usage: node localization-generate.js <xliffPrefix> [extensionPath]");
        logger.error("Example: node localization-generate.js vscode-mssql ./extensions/mssql");
        process.exit(1);
    }

    generateRuntimeLocalizationForExtension(xliffPrefix, extensionPath)
        .then(() => {
            logger.success("Script completed successfully!");
            process.exit(0);
        })
        .catch((error) => {
            logger.error(`Script failed: ${error.message}`);
            process.exit(1);
        });
}
