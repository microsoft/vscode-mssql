/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vscodeTestCli = path.join(
    extensionRoot,
    "node_modules",
    "@vscode",
    "test-cli",
    "out",
    "bin.mjs",
);
const npmCommand = "npm";

function printUsage() {
    console.log(`Usage:
  npm test
  npm test -- test/unit/<name>.test.ts [more test files]

Tests run with coverage. Source test paths are compiled and mapped to out/test/**/*.test.js automatically.`);
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: extensionRoot,
        stdio: "inherit",
        ...options,
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function runNpmScript(script) {
    run(npmCommand, ["run", script], { shell: process.platform === "win32" });
}

function parseArgs(args) {
    const files = [];

    for (const arg of args) {
        if (arg === "--help" || arg === "-h") {
            printUsage();
            process.exit(0);
        }

        if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
        }

        files.push(arg);
    }

    return files;
}

function resolveExtensionPath(file) {
    const normalizedInput = file.replaceAll("\\", "/");
    const repoRelativePrefix = "extensions/mssql/";

    if (normalizedInput.startsWith(repoRelativePrefix)) {
        return path.resolve(extensionRoot, normalizedInput.slice(repoRelativePrefix.length));
    }

    return path.resolve(extensionRoot, file);
}

function toCompiledTestPath(file) {
    const absolutePath = resolveExtensionPath(file);
    const relativePath = path.relative(extensionRoot, absolutePath);
    const relativePosixPath = relativePath.split(path.sep).join("/");

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`Test file must be inside ${extensionRoot}: ${file}`);
    }

    if (relativePosixPath.startsWith("test/unit/") && relativePosixPath.endsWith(".test.ts")) {
        return path.join(extensionRoot, "out", relativePath.slice(0, -".ts".length) + ".js");
    }

    if (relativePosixPath.startsWith("out/test/unit/") && relativePosixPath.endsWith(".test.js")) {
        return absolutePath;
    }

    throw new Error(
        `Expected a test/unit/**/*.test.ts source path or out/test/unit/**/*.test.js output path: ${file}`,
    );
}

function getTestLabel(compiledTestPath) {
    const databaseProjectsDirectory = path.join(
        extensionRoot,
        "out",
        "test",
        "unit",
        "databaseProjects",
    );
    const relativePath = path.relative(databaseProjectsDirectory, compiledTestPath);
    const isDatabaseProjectsTest =
        relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);

    return isDatabaseProjectsTest ? "SQL Database Projects Unit Tests" : "Unit Tests";
}

function buildTests() {
    runNpmScript("clean:test-output");
    runNpmScript("build:extension:emit");
    runNpmScript("build:extension-bundle");
}

function runTests(files) {
    if (!existsSync(vscodeTestCli)) {
        throw new Error(
            `VS Code test CLI was not found at ${vscodeTestCli}. Run npm install first.`,
        );
    }

    if (files.length === 0) {
        run(process.execPath, [vscodeTestCli, "--coverage"]);
        return;
    }

    const filesByLabel = new Map();
    for (const file of files) {
        if (!existsSync(file)) {
            throw new Error(`Compiled test file was not generated: ${file}`);
        }

        const label = getTestLabel(file);
        const labelFiles = filesByLabel.get(label) ?? [];
        labelFiles.push(file);
        filesByLabel.set(label, labelFiles);
    }

    for (const [label, labelFiles] of filesByLabel) {
        run(process.execPath, [
            vscodeTestCli,
            "--label",
            label,
            "--coverage",
            "--run",
            ...labelFiles,
        ]);
    }
}

try {
    const files = parseArgs(process.argv.slice(2));
    const compiledTestFiles = [...new Set(files.map(toCompiledTestPath))];

    buildTests();
    runTests(compiledTestFiles);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
