/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs").promises;

// Prettier output respects endOfLine, but enforce CRLF after formatting to guard against
// contributors with custom setups.
const CRLF = "\r\n";
const LF = "\n";

/**
 * Formats content using Prettier
 * @param {string} filePath - Path used to resolve Prettier config and infer parser
 * @param {string} content - File content to format
 * @returns {Promise<string>} Formatted content
 */
async function formatContentWithPrettier(filePath, content) {
    const prettier = await import("prettier");
    const options = await prettier.resolveConfig(filePath);
    return await prettier.format(content, {
        ...options,
        filepath: filePath,
    });
}

/**
 * Formats files using Prettier
 * @param {string|string[]} filePaths - Single file path or array of file paths to format
 * @returns {Promise<boolean>} True if formatting succeeded, false otherwise
 */
async function formatWithPrettier(filePaths) {
    try {
        const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
        for (const filePath of paths) {
            const content = await fs.readFile(filePath, "utf8");
            await fs.writeFile(filePath, await formatContentWithPrettier(filePath, content));
        }
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Writes a file and formats it with Prettier
 * @param {string} filePath - Path to the file to write
 * @param {string} content - Content to write
 * @param {boolean} [prettier=true] - Whether to format the file with Prettier
 * @param {boolean} [crlf=false] - Whether to use CRLF line endings
 * @returns {Promise<boolean>} True if formatting succeeded, false otherwise
 */
async function writeAndFormat(filePath, content, prettier = true, crlf = false) {
    let finalContent = content;
    if (prettier) {
        try {
            finalContent = await formatContentWithPrettier(filePath, finalContent);
        } catch (error) {
            await fs.writeFile(
                filePath,
                crlf ? finalContent.replace(/\r?\n/g, CRLF) : finalContent,
            );
            return false;
        }
    }

    if (crlf) {
        finalContent = finalContent.replace(/\r?\n/g, CRLF);
    }

    await fs.writeFile(filePath, finalContent);
    return true;
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
    return await writeAndFormat(filePath, content, true, true);
}

module.exports = {
    formatContentWithPrettier,
    formatWithPrettier,
    writeAndFormat,
    writeJsonAndFormat,
};
