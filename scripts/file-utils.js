/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs").promises;
const { execSync } = require("child_process");

// Prettier output respects endOfLine, but enforce CRLF after formatting to guard against
// contributors with custom setups.
const CRLF = "\r\n";
const LF = "\n";

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
 * @param {boolean} [prettier=true] - Whether to format the file with Prettier
 * @param {boolean} [crlf=false] - Whether to use CRLF line endings
 * @returns {Promise<boolean>} True if formatting succeeded, false otherwise
 */
async function writeAndFormat(
  filePath,
  content,
  prettier = true,
  crlf = false,
) {
  const finalContent = crlf ? content.replace(/\r?\n/g, CRLF) : content;
  await fs.writeFile(filePath, finalContent);
  if (prettier) {
    const formatted = await formatWithPrettier(filePath);
    if (!formatted) {
      return false;
    }
  }

  if (crlf) {
    const data = await fs.readFile(filePath, "utf8");
    const crlfData = data.replace(/\r?\n/g, CRLF);
    await fs.writeFile(filePath, crlfData);
  }

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
  formatWithPrettier,
  writeAndFormat,
  writeJsonAndFormat,
};
