/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { SaralSqlAnalysisEngine } = require("../dist/adapters");

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const defaultCorpus = path.resolve(packageDirectory, "../../../sql-test-files/mssql");
const options = parseArguments(process.argv.slice(2));
const corpusRoot = path.resolve(options.root ?? defaultCorpus);
// These source files explicitly exercise incomplete strings, parser damage, or semantic errors.
// Keep this list narrow: a new diagnostic, even in one of these files, must be reviewed.
const knownIntentionalDiagnostics = [
    { file: "multiline_parser_stress_unfinished_strings.sql", line: 17, code: "PARSE_COLUMN" },
    { file: "multiline_parser_stress_unfinished_strings.sql", line: 28, code: "syntax" },
    { file: "multiline_parser_stress_unfinished_strings.sql", line: 50, code: "syntax" },
    { file: "multiline_parser_stress_unfinished_strings.sql", line: 72, code: "syntax" },
    { file: "multiline_parser_stress_unfinished_strings.sql", line: 94, code: "syntax" },
    { file: "sad_face_parser_stress.sql", line: 1, code: "VAR001" },
    { file: "tricky_bracket_parser_stress.sql", line: 31, code: "syntax" },
];
const catalog = options.live ? await loadLiveCatalog(options.database) : undefined;
const engine = new SaralSqlAnalysisEngine();
const files = await findSqlFiles(corpusRoot);
const observed = [];

for (const file of files) {
    const text = await readFile(file, "utf8");
    const snapshot = engine.createSnapshot({
        uri: pathToDisplayPath(file),
        text,
        catalog,
    });
    for (const diagnostic of [...snapshot.syntaxDiagnostics, ...snapshot.semanticDiagnostics]) {
        const position = snapshot.positionAt(diagnostic.span.start);
        observed.push({
            file: path.relative(corpusRoot, file).replaceAll("\\", "/"),
            line: position.line + 1,
            column: position.character + 1,
            code: String(diagnostic.code ?? diagnostic.kind),
            message: diagnostic.message,
        });
    }
}

for (const diagnostic of observed) {
    const marker = isKnownIntentionalDiagnostic(diagnostic) ? "known-invalid" : "unexpected";
    console.log(
        `${marker}: ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ` +
            `[${diagnostic.code}] ${diagnostic.message}`,
    );
}

const unexpected = observed.filter((diagnostic) => !isKnownIntentionalDiagnostic(diagnostic));
console.log(
    `Audited ${files.length} T-SQL files (${options.live ? "closed live catalog" : "open catalog"}): ` +
        `${observed.length} diagnostics, ${unexpected.length} unexpected.`,
);
if (unexpected.length > 0 && !options.reportOnly) {
    process.exitCode = 1;
}

function isKnownIntentionalDiagnostic(diagnostic) {
    return knownIntentionalDiagnostics.some(
        (known) =>
            known.file === diagnostic.file &&
            known.line === diagnostic.line &&
            known.code === diagnostic.code,
    );
}

async function loadLiveCatalog(database) {
    const connectionString = process.env.MSSQL_TEST_CONNECTION_STRING;
    if (!connectionString) {
        throw new Error("--live requires MSSQL_TEST_CONNECTION_STRING in the environment or .env");
    }
    const {
        DatabaseMetadataLoader,
        MetadataAnalysisCatalogAdapter,
        MetadataRepository,
    } = require("../dist/metadata");
    const { parseSqlServerConnectionString } = require("../dist/metadata/connectionString");
    const { TediousQueryExecutor } = require("../dist/metadata/tediousQueryExecutor");
    const parsed = parseSqlServerConnectionString(connectionString);
    const configuration = database
        ? { ...parsed, options: { ...parsed.options, database } }
        : parsed;
    const repository = new MetadataRepository(
        new DatabaseMetadataLoader(new TediousQueryExecutor(configuration)),
    );
    return new MetadataAnalysisCatalogAdapter(await repository.load());
}

async function findSqlFiles(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            result.push(...(await findSqlFiles(entryPath)));
        } else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".sql")) {
            result.push(entryPath);
        }
    }
    return result.sort((left, right) => left.localeCompare(right));
}

function pathToDisplayPath(file) {
    return `file:///${file.replaceAll("\\", "/")}`;
}

function parseArguments(arguments_) {
    const result = { live: false, reportOnly: false, root: undefined, database: undefined };
    for (let index = 0; index < arguments_.length; index++) {
        switch (arguments_[index]) {
            case "--live":
                result.live = true;
                break;
            case "--report-only":
                result.reportOnly = true;
                break;
            case "--root":
                result.root = requiredValue(arguments_, ++index, "--root");
                break;
            case "--database":
                result.database = requiredValue(arguments_, ++index, "--database");
                break;
            default:
                throw new Error(`Unknown argument: ${arguments_[index]}`);
        }
    }
    return result;
}

function requiredValue(arguments_, index, option) {
    const value = arguments_[index];
    if (!value) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}
