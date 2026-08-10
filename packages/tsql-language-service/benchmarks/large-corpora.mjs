/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MEBIBYTE = 1024 * 1024;

export const LARGE_CORPUS_SPECS = Object.freeze([
    Object.freeze({ name: "tsql-1mib.sql", mebibytes: 1, bytes: MEBIBYTE }),
    Object.freeze({ name: "tsql-10mib.sql", mebibytes: 10, bytes: 10 * MEBIBYTE }),
    Object.freeze({ name: "tsql-50mib.sql", mebibytes: 50, bytes: 50 * MEBIBYTE }),
]);

export const DEFAULT_OUTPUT_DIRECTORY = fileURLToPath(new URL("./generated/", import.meta.url));

const STATEMENTS_PER_BATCH = 6;
const EDIT_MARKER = "/*large-benchmark-edit*/";
const BATCH = Buffer.from(
    [
        "-- Deterministic generated T-SQL parser benchmark batch.",
        "SELECT c.CustomerId, c.DisplayName, SUM(i.Amount) AS TotalAmount",
        "FROM dbo.Customers AS c",
        "LEFT JOIN Sales.Invoices AS i ON i.CustomerId = c.CustomerId",
        `WHERE i.Amount >= 1000 ${EDIT_MARKER}`,
        "GROUP BY c.CustomerId, c.DisplayName;",
        "WITH RankedInvoices AS (",
        "    SELECT i.InvoiceId, i.CustomerId,",
        "           ROW_NUMBER() OVER (PARTITION BY i.CustomerId ORDER BY i.IssuedAt DESC) AS rn",
        "    FROM Sales.Invoices AS i",
        ")",
        "SELECT InvoiceId, CustomerId FROM RankedInvoices WHERE rn <= 10;",
        "UPDATE c SET CreditLimit = i.Amount",
        "FROM dbo.Customers AS c",
        "JOIN Sales.Invoices AS i ON i.CustomerId = c.CustomerId",
        "WHERE i.Amount >= 1000;",
        "DELETE a FROM dbo.AuditLog AS a",
        "JOIN dbo.Customers AS c ON c.CustomerId = a.CustomerId",
        "WHERE a.AuditId < 1000;",
        "INSERT INTO dbo.AuditLog (CustomerId, Message)",
        "SELECT c.CustomerId, N'generated benchmark row'",
        "FROM dbo.Customers AS c WHERE c.CustomerId <= 1000;",
        "MERGE dbo.CustomerSummary AS target",
        "USING dbo.Customers AS source ON source.CustomerId = target.CustomerId",
        "WHEN MATCHED THEN UPDATE SET target.DisplayName = source.DisplayName",
        "WHEN NOT MATCHED THEN INSERT (CustomerId, DisplayName)",
        "VALUES (source.CustomerId, source.DisplayName);",
        "EXEC dbo.RefreshCustomerSummary @MinimumAmount = 1000;",
        "GO",
        "",
    ].join("\n"),
    "utf8",
);

/** Materialize deterministic, exactly sized SQL files without checking large generated files in. */
export async function materializeLargeCorpora({
    outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
    specs = LARGE_CORPUS_SPECS,
} = {}) {
    await mkdir(outputDirectory, { recursive: true });
    const manifest = [];
    for (const spec of specs) {
        const buffer = createCorpusBuffer(spec.bytes);
        const file = new URL(spec.name, pathToDirectoryUrl(outputDirectory));
        await writeFile(file, buffer);
        const actual = await stat(file);
        if (actual.size !== spec.bytes) {
            throw new Error(`${spec.name}: expected ${spec.bytes} bytes, wrote ${actual.size}`);
        }
        const completeBatchCount = Math.floor(spec.bytes / BATCH.length);
        const paddingBytes = spec.bytes - completeBatchCount * BATCH.length;
        manifest.push({
            ...spec,
            path: fileURLToPath(file),
            sha256: createHash("sha256").update(buffer).digest("hex"),
            batchCount: completeBatchCount + (paddingBytes === 0 ? 0 : 1),
            completeBatchCount,
            paddingBytes,
            logicalStatements: completeBatchCount * STATEMENTS_PER_BATCH,
        });
    }
    await writeFile(
        new URL("manifest.json", pathToDirectoryUrl(outputDirectory)),
        `${JSON.stringify({ schemaVersion: 1, corpora: manifest }, null, 2)}\n`,
        "utf8",
    );
    return manifest;
}

export async function readLargeCorpus(entry) {
    const buffer = await readFile(entry.path);
    if (buffer.length !== entry.bytes) {
        throw new Error(`${entry.name}: expected ${entry.bytes} bytes, read ${buffer.length}`);
    }
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== entry.sha256) {
        throw new Error(`${entry.name}: generated-file checksum mismatch`);
    }
    const text = buffer.toString("utf8");
    if (Buffer.byteLength(text, "utf8") !== entry.bytes) {
        throw new Error(`${entry.name}: UTF-8 text round-trip changed the exact corpus byte size`);
    }
    return text;
}

export function editMiddleBatch(text) {
    const middle = Math.floor(text.length / 2);
    let marker = text.indexOf(EDIT_MARKER, middle);
    if (marker < 0) {
        marker = text.lastIndexOf(EDIT_MARKER, middle);
    }
    const literal = text.lastIndexOf("1000", marker);
    if (marker < 0 || literal < 0) {
        throw new Error("Generated corpus does not contain the middle edit marker");
    }
    const edited = `${text.slice(0, literal)}1001${text.slice(literal + 4)}`;
    if (Buffer.byteLength(edited, "utf8") !== Buffer.byteLength(text, "utf8")) {
        throw new Error("Large corpus middle edit must preserve the exact byte size");
    }
    return edited;
}

function createCorpusBuffer(targetBytes) {
    if (!Number.isSafeInteger(targetBytes) || targetBytes < BATCH.length) {
        throw new Error(`Corpus size must be an integer of at least ${BATCH.length} bytes`);
    }
    const result = Buffer.alloc(targetBytes, 0x20);
    const completeBatchCount = Math.floor(targetBytes / BATCH.length);
    for (let index = 0; index < completeBatchCount; index++) {
        BATCH.copy(result, index * BATCH.length);
    }
    return result;
}

function pathToDirectoryUrl(path) {
    const url = pathToFileURL(path);
    return new URL(url.href.endsWith("/") ? url.href : `${url.href}/`);
}
