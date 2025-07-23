/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscodel10n = require("@vscode/l10n-dev");
const fs = require("fs").promises;
const path = require("path");
const logger = require("./terminal-logger");

/**
 * Scans the src directory for TypeScript files and extracts their content
 * @returns {Promise<Object>} L10n JSON object containing localization data
 */
async function getL10nJson() {
    logger.step("Scanning source files for localization strings...");

    try {
        // Read all files in src directory recursively
        const srcFiles = await fs.readdir("./src", { recursive: true });
        const tsFiles = srcFiles.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

        logger.info(`Found ${tsFiles.length} TypeScript files to process`);

        const fileContents = [];
        let processedFiles = 0;

        // Process each TypeScript file
        for (const file of tsFiles) {
            try {
                const filePath = path.resolve("./src", file);
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
 * Extracts localization strings from both extension and webview code
 * Generates English language l10n and XLIFF files for translation
 */
async function extractLocalizationStrings() {
    logger.header("Localization String Extraction");
    logger.step("Starting localization string extraction process");

    try {
        // Get localization data from source files
        const bundleJSON = await getL10nJson();

        logger.step("Loading package localization data...");

        // Create map with package and bundle localization data
        const map = new Map();

        try {
            const packageNlsContent = await fs.readFile(path.resolve("package.nls.json"), "utf8");
            map.set("package", JSON.parse(packageNlsContent));
            logger.success("Loaded package.nls.json");
        } catch (error) {
            logger.warning(`Could not load package.nls.json: ${error.message}`);
            map.set("package", {});
        }

        map.set("bundle", bundleJSON);

        // Write bundle L10n JSON file
        logger.step("Writing bundle localization file...");
        const stringBundle = JSON.stringify(bundleJSON, null, 2);
        await fs.writeFile("./localization/l10n/bundle.l10n.json", stringBundle);
        logger.success("Created ./localization/l10n/bundle.l10n.json");

        // Generate XLIFF file for translators
        logger.step("Generating XLIFF file for translation...");
        const stringXLIFF = vscodel10n.getL10nXlf(map);
        await fs.writeFile("./localization/xliff/vscode-mssql.xlf", stringXLIFF);
        logger.success("Created ./localization/xliff/vscode-mssql.xlf");

        logger.success("Localization string extraction completed successfully!");
    } catch (error) {
        logger.error(`Localization extraction failed: ${error.message}`);
        throw error;
    }
}

module.exports = {
    extractLocalizationStrings,
    getL10nJson,
};

if (require.main === module) {
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
