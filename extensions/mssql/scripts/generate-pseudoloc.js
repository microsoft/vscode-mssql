/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs").promises;
const logger = equire("../../../scripts/terminal-logger");
const getL10nJson = require("./extract-localization").getL10nJson;
const vscodel10n = require("@vscode/l10n-dev");
const path = require("path");

/**
 * Gets the extracted loc strings and package.nls.json and generates pseudo-localized versions
 * for testing purposes. It creates:
 * - bundle.l10n.qps-ploc.json for bundle strings
 * - package.nls.qps-ploc.json for package strings
 */
async function generatePseudoLocalizationFiles() {
    logger.header("Pseudo Localization Generation");

    logger.step("Reading extracted localization strings");
    const bundle = await getL10nJson();
    logger.step("Reading package.nls.json");
    const packageJson = JSON.parse(await fs.readFile(path.resolve("package.nls.json"), "utf8"));

    logger.info(`Found ${Object.keys(bundle).length} bundle strings`);
    logger.info(`Found ${Object.keys(packageJson).length} package strings`);

    logger.step("Generating pseudo-localized files");
    const pseudoLocBundle = await vscodel10n.getL10nPseudoLocalized(bundle);
    const pseudoLocPackage = await vscodel10n.getL10nPseudoLocalized(packageJson);

    logger.step("Writing pseudo-localized files");
    await fs.writeFile(
        "./localization/l10n/bundle.l10n.qps-ploc.json",
        JSON.stringify(pseudoLocBundle, null, 2),
    );
    logger.step("Writing package.nls.qps-ploc.json");
    await fs.writeFile("./package.nls.qps-ploc.json", JSON.stringify(pseudoLocPackage, null, 2));
}

module.exports = {
    generatePseudoLocalizationFiles,
};

if (require.main === module) {
    logger.step("Starting pseudo localization file generation");

    generatePseudoLocalizationFiles()
        .then(() => {
            logger.success("Pseudo localization files generated successfully");
        })
        .catch((error) => {
            logger.error(`Failed to generate pseudo localization files: ${error.message}`);
            process.exit(1);
        });
}
