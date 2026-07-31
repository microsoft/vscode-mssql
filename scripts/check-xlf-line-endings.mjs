#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CR = 0x0d;
const LF = 0x0a;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const xliffDirectory = path.join(repositoryRoot, "localization", "xliff");

export function validateCrLf(buffer) {
    for (let index = 0; index < buffer.length; index++) {
        if (buffer[index] === CR) {
            if (buffer[index + 1] !== LF) {
                return { index, reason: "CR not followed by LF" };
            }
            index++;
        } else if (buffer[index] === LF) {
            return { index, reason: "LF not preceded by CR" };
        }
    }

    return undefined;
}

async function main() {
    const entries = await readdir(xliffDirectory, { withFileTypes: true });
    const xliffFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".xlf"))
        .map((entry) => entry.name)
        .sort();

    const failures = [];
    for (const file of xliffFiles) {
        const filePath = path.join(xliffDirectory, file);
        const invalidEnding = validateCrLf(await readFile(filePath));
        if (invalidEnding) {
            failures.push(
                `${path.relative(repositoryRoot, filePath)}: byte ${invalidEnding.index + 1}: ${
                    invalidEnding.reason
                }`,
            );
        }
    }

    if (failures.length > 0) {
        console.error("XLF line-ending validation failed:");
        for (const failure of failures) {
            console.error(`  ${failure}`);
        }
        process.exitCode = 1;
    } else {
        console.log(`Verified CRLF line endings in ${xliffFiles.length} XLF files.`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
