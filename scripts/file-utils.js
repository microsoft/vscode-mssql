/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs").promises;

/**
 * Writes a file with LF line endings, regardless of platform
 * @param {string} filePath - Path to the file to write
 * @param {string} content - Content to write
 * @returns {Promise<void>}
 */
async function writeFileWithLF(filePath, content) {
    const normalizedContent = content.replace(/\r\n/g, "\n");
    await fs.writeFile(filePath, normalizedContent);
}

/**
 * Writes a JSON object to a file with LF line endings and trailing newline
 * @param {string} filePath - Path to the file to write
 * @param {Object} data - JSON data to write
 * @param {number} indent - Number of spaces for indentation (default: 2)
 * @returns {Promise<void>}
 */
async function writeJsonWithLF(filePath, data, indent = 2) {
    const content = JSON.stringify(data, null, indent) + "\n";
    await writeFileWithLF(filePath, content);
}

module.exports = {
    writeFileWithLF,
    writeJsonWithLF,
};
