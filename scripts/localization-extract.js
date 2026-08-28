/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscodel10n = require("@vscode/l10n-dev");
const fs = require("fs").promises;
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const logger = require("./terminal-logger");
const { writeJsonAndFormat, writeAndFormat } = require("./file-utils");

const execFileAsync = promisify(execFile);
const rootPath = path.resolve(__dirname, "..");

/**
 * Project configuration mapping.
 * Maps project names to their paths, XLIFF file names, and localization source files.
 */
const PROJECT_CONFIG = {
    "extension-toolkit": {
        projectPath: "packages/extension-toolkit",
        xliffName: "extension-toolkit",
        sourceFiles: ["src/base/localization/locConstants.ts"],
        includePackageLocalization: false,
    },
    mssql: {
        projectPath: "extensions/mssql",
        xliffName: "vscode-mssql",
        sourceFiles: [
            "src/constants/locConstants.ts",
            "src/webviews/common/locConstants.ts",
            "src/databaseProjects/common/constants.ts",
        ],
    },
    "sql-database-projects": {
        projectPath: "extensions/sql-database-projects",
        xliffName: "sql-database-projects",
        sourceFiles: [],
    },
    "data-workspace": {
        projectPath: "extensions/data-workspace",
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
 * Reads configured localization source files for a project and extracts their content.
 * @param {string} projectPath - Path to the project directory
 * @param {string[]} sourceFiles - Localization source files relative to the project directory
 * @param {(filePath: string) => Promise<string> | string} readSourceFile - Reads a source file
 * @returns {Promise<Object>} L10n JSON object containing localization data
 */
async function getL10nJson(projectPath, sourceFiles, readSourceFile = fs.readFile) {
    logger.step("Reading localization source files...");

    try {
        logger.info(`Found ${sourceFiles.length} localization source files to process`);

        const fileContents = [];
        let processedFiles = 0;

        for (const file of sourceFiles) {
            try {
                const filePath = path.resolve(projectPath, file);
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

function getProjectPath(projectName) {
    return path.resolve(rootPath, PROJECT_CONFIG[projectName].projectPath);
}

async function readSourceFileFromGitIndex(filePath) {
    const relativePath = path.relative(rootPath, filePath).replace(/\\/g, "/");
    const { stdout } = await execFileAsync("git", ["show", `:${relativePath}`], {
        cwd: rootPath,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
}

async function writeLocalizationOutputs(projectName, xliffName, packageJSON, bundleJSON) {
    const map = new Map();
    if (packageJSON) {
        map.set("package", packageJSON);
    }
    map.set("bundle", bundleJSON);

    const projectPath = getProjectPath(projectName);
    const projectL10nDir = path.join(projectPath, "l10n");
    await fs.mkdir(projectL10nDir, { recursive: true });
    const xliffDir = path.join(rootPath, "localization", "xliff");
    await fs.mkdir(xliffDir, { recursive: true });

    logger.step("Writing bundle localization file...");
    const bundlePath = path.join(projectL10nDir, "bundle.l10n.json");
    const formatted1 = await writeJsonAndFormat(bundlePath, bundleJSON);
    if (formatted1) {
        logger.success(`Created and formatted ${bundlePath}`);
    } else {
        logger.warning(`Created ${bundlePath} (formatting failed)`);
    }

    logger.step("Generating XLIFF file for translation...");
    const stringXLIFF = vscodel10n.getL10nXlf(map);
    const xliffPath = path.join(xliffDir, `${xliffName}.xlf`);
    const formatted2 = await writeAndFormat(
        xliffPath,
        stringXLIFF,
        false, // We don't want to run prettier on XLIFF files
        true, // OneLoc XLIFF files are stored with literal CRLF line endings
    );
    if (formatted2) {
        logger.success(`Created ${xliffPath}`);
    } else {
        logger.warning(`Created ${xliffPath} (formatting failed)`);
    }

    return [bundlePath.replace(/\\/g, "/"), xliffPath];
}

/**
 * Extracts localization strings for a single project.
 * @param {string} projectName - Configured project name
 * @param {string} xliffName - Name for the XLIFF file
 */
async function extractLocalizationForExtension(projectName, xliffName, options = {}) {
    logger.header(`Processing Project: ${projectName}`);

    const config = PROJECT_CONFIG[projectName];
    const projectPath = getProjectPath(projectName);
    const readSourceFile = options.staged ? readSourceFileFromGitIndex : fs.readFile;

    try {
        const bundleJSON = await getL10nJson(projectPath, config.sourceFiles, readSourceFile);

        let packageJSON;
        if (config.includePackageLocalization !== false) {
            logger.step("Loading package localization data...");
            try {
                const packageNlsPath = path.join(projectPath, "package.nls.json");
                const packageNlsContent = await readSourceFile(packageNlsPath, "utf8");
                packageJSON = JSON.parse(packageNlsContent);
                logger.success("Loaded package.nls.json");
            } catch (error) {
                logger.warning(`Could not load package.nls.json: ${error.message}`);
                packageJSON = {};
            }
        }

        await writeLocalizationOutputs(projectName, xliffName, packageJSON, bundleJSON);

        logger.success(`Localization extraction for ${projectName} completed successfully!`);
        logger.newline();
    } catch (error) {
        logger.error(`Localization extraction for ${projectName} failed: ${error.message}`);
        throw error;
    }
}

/**
 * Extracts localization strings from all configured projects.
 * Generates English language l10n and XLIFF files for translation in the root localization directory
 */
async function extractLocalizationStrings(options = {}) {
    logger.header("Localization String Extraction - All Projects");
    logger.step("Starting localization string extraction process");
    logger.newline();

    try {
        const projects = Object.entries(PROJECT_CONFIG);

        for (const [projectName, config] of projects) {
            await extractLocalizationForExtension(projectName, config.xliffName, options);
        }

        logger.header("All Projects Processed Successfully");
        logger.success(
            `Extracted localization for ${projects.length} project(s) to root localization/`,
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
    // Check if a specific project is requested via command line args
    const args = process.argv.slice(2);
    const staged = args.includes("--staged");
    const specificProject = args.find((arg) => !arg.startsWith("--"));

    if (specificProject) {
        // Extract for a specific project
        const config = PROJECT_CONFIG[specificProject];
        if (!config) {
            logger.error(
                `Unknown project: ${specificProject}. Available projects: ${Object.keys(PROJECT_CONFIG).join(", ")}`,
            );
            process.exit(1);
        }

        extractLocalizationForExtension(specificProject, config.xliffName, { staged })
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
        extractLocalizationStrings({ staged })
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
