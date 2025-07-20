/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscodel10n = require("@vscode/l10n-dev");
const fs = require('fs').promises;
const path = require('path');
const logger = require("./terminal-logger");

/**
 * Generates runtime localization files for the extension
 * Processes XLIFF files from the localization team and creates:
 * - l10n files for bundle strings
 * - package.nls files for package strings
 * Supports all configured languages
 */
async function generateRuntimeLocalizationFiles() {
    logger.header("Runtime Localization Generation");
    logger.step("Starting runtime localization file generation");

    try {
        // Read all XLIFF files from localization directory
        const xliffFiles = (await fs.readdir("./localization/xliff")).filter((f) =>
            f.endsWith(".xlf"),
        );

        logger.info(`Found ${xliffFiles.length} XLIFF files to process`);

        let processedLanguages = 0;
        let generatedFiles = 0;

        // Process each XLIFF file (except the source file)
        for (const xliffFile of xliffFiles) {
            // Skip the source XLIFF file (English template)
            if (xliffFile === "vscode-mssql.xlf") {
                logger.debug(`Skipping source file: ${xliffFile}`);
                continue;
            }

            logger.step(`Processing language file: ${xliffFile}`);

            try {
                // Read XLIFF file content
                const xliffFilePath = path.resolve("./localization/xliff", xliffFile);
                const xliffFileContents = await fs.readFile(xliffFilePath, "utf8");

                // Set up output directories
                const l10nDir = path.resolve(__dirname, "..", "localization", "l10n");
                const packageDir = path.resolve(__dirname, "..");

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

                        const filePath = path.resolve(l10nDir, fileName);
                        await fs.writeFile(filePath, JSON.stringify(fileContent.messages, null, 2));
                        logger.success(`Created bundle file: ${fileName}`);
                        generatedFiles++;
                    } else if (fileContent.name === "package") {
                        // Skip English package files (manually maintained)
                        if (fileContent.language === "enu") {
                            logger.debug("Skipping English package file (manually maintained)");
                            continue;
                        }

                        // Generate package localization file
                        const fileName = `package.nls.${fileContent.language}.json`;
                        const filePath = path.resolve(packageDir, fileName);
                        await fs.writeFile(filePath, JSON.stringify(fileContent.messages, null, 2));
                        logger.success(`Created package file: ${fileName}`);
                        generatedFiles++;
                    }
                }

                processedLanguages++;
            } catch (error) {
                logger.error(`Failed to process ${xliffFile}: ${error.message}`);
            }
        }

        logger.success(`✨ Runtime localization generation completed!`);
        logger.info(
            `📊 Summary: Processed ${processedLanguages} languages, generated ${generatedFiles} files`,
        );
    } catch (error) {
        logger.error(`Runtime localization generation failed: ${error.message}`);
        throw error;
    }
}

module.exports = {
    generateRuntimeLocalizationFiles,
};

if (require.main === module) {
    generateRuntimeLocalizationFiles()
        .then(() => {
            logger.success("🎉 Script completed successfully!");
            process.exit(0);
        })
        .catch((error) => {
            logger.error(`💥 Script failed: ${error.message}`);
            process.exit(1);
        });
}
