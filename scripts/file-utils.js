/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs").promises;
const { execSync } = require("child_process");

/**
 * Formats files using Prettier
 * @param {string|string[]} filePaths - Single file path or array of file paths to format
 * @returns {Promise<boolean>} True if formatting succeeded, false otherwise
 */
async function formatWithPrettier(filePaths) {
    try {
        const paths = Array.isArray(filePaths) ? filePaths.join(" ") : filePaths;
        execSync(`npx prettier --write ${paths}`, {
            stdio: "inherit",
        });
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Writes a file and formats it with Prettier
 * @param {string} filePath - Path to the file to write
 * @param {string} content - Content to write
 * @returns {Promise<boolean>} True if formatting succeeded, false otherwise
 */
async function writeAndFormat(filePath, content, prettier = false) {
    await fs.writeFile(filePath, content);
    return prettier ? await formatWithPrettier(filePath) : true;
}

/**
 * Writes a JSON file and formats it with Prettier
 * @param {string} filePath - Path to the file to write
 * @param {Object} data - JSON data to write
 * @param {number} indent - Number of spaces for indentation (default: 2)
 * @returns {Promise<boolean>} True if formatting succeeded, false otherwise
 */
async function writeJsonAndFormat(filePath, data, indent = 2) {
    const content = JSON.stringify(data, null, indent);
    return await writeAndFormat(filePath, content);
}

module.exports = {
    formatWithPrettier,
    writeAndFormat,
    writeJsonAndFormat,
};
