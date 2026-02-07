/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { PassThrough } from "stream";
import {
    sanitizeCsvValue,
    formatCsvCell,
    generateExportTimestamp,
    generateCsvContent,
} from "../../../src/sharedInterfaces/csvUtils";

// Helper to create null value without direct literal
function getNullValue(): unknown {
    return JSON.parse("null");
}

// Helper to collect stream output for testing
async function collectStreamOutput(
    streamWriter: (stream: PassThrough) => Promise<void>,
): Promise<string> {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();

    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

    await streamWriter(stream);
    stream.end();

    return new Promise((resolve, reject) => {
        stream.on("finish", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", reject);
    });
}

suite("CSV Utils Tests", () => {
    suite("sanitizeCsvValue", () => {
        test("should prefix values starting with = with single quote", () => {
            expect(sanitizeCsvValue("=cmd|'/C calc'!A0")).to.equal("'=cmd|'/C calc'!A0");
        });

        test("should prefix values starting with + with single quote", () => {
            expect(sanitizeCsvValue("+1+2")).to.equal("'+1+2");
        });

        test("should prefix values starting with - with single quote", () => {
            expect(sanitizeCsvValue("-1-2")).to.equal("'-1-2");
        });

        test("should prefix values starting with @ with single quote", () => {
            expect(sanitizeCsvValue("@sum(A1:A10)")).to.equal("'@sum(A1:A10)");
        });

        test("should prefix values starting with tab with single quote", () => {
            expect(sanitizeCsvValue("\tvalue")).to.equal("'\tvalue");
        });

        test("should not modify safe values", () => {
            expect(sanitizeCsvValue("SELECT * FROM users")).to.equal("SELECT * FROM users");
            expect(sanitizeCsvValue("123")).to.equal("123");
            expect(sanitizeCsvValue("")).to.equal("");
        });
    });

    suite("formatCsvCell", () => {
        test("should return empty quoted string for null", () => {
            expect(formatCsvCell(getNullValue())).to.equal('""');
        });

        test("should return empty quoted string for undefined", () => {
            expect(formatCsvCell(undefined)).to.equal('""');
        });

        test("should handle numeric zero correctly", () => {
            expect(formatCsvCell(0)).to.equal('"0"');
        });

        test("should handle boolean false correctly", () => {
            expect(formatCsvCell(false)).to.equal('"false"');
        });

        test("should escape double quotes in values", () => {
            expect(formatCsvCell('He said "hello"')).to.equal('"He said ""hello"""');
        });

        test("should replace newlines with spaces", () => {
            expect(formatCsvCell("line1\nline2")).to.equal('"line1 line2"');
            expect(formatCsvCell("line1\r\nline2")).to.equal('"line1 line2"');
            expect(formatCsvCell("line1\rline2")).to.equal('"line1 line2"');
        });

        test("should sanitize formula injection characters", () => {
            expect(formatCsvCell("=SUM(A1:A10)")).to.equal('"\'=SUM(A1:A10)"');
            expect(formatCsvCell("+1")).to.equal('"\'+1"');
        });

        test("should handle numbers correctly", () => {
            expect(formatCsvCell(42)).to.equal('"42"');
            expect(formatCsvCell(3.14)).to.equal('"3.14"');
        });

        test("should handle Date objects correctly", () => {
            const date = new Date("2024-02-05T10:30:00.000Z");
            expect(formatCsvCell(date)).to.equal('"2024-02-05T10:30:00.000Z"');
        });

        test("should handle empty string", () => {
            expect(formatCsvCell("")).to.equal('""');
        });
    });

    suite("generateExportTimestamp", () => {
        test("should return timestamp in expected format", () => {
            const timestamp = generateExportTimestamp();
            // Format: YYYY-MM-DD-HH-mm-ss
            expect(timestamp).to.match(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
        });

        test("should not contain colons or T character", () => {
            const timestamp = generateExportTimestamp();
            expect(timestamp).to.not.include(":");
            expect(timestamp).to.not.include("T");
        });
    });

    suite("generateCsvContent", () => {
        test("should generate CSV with headers and data rows", async () => {
            const columns = [
                { field: "name", header: "Name" },
                { field: "age", header: "Age" },
            ];
            const rows = [
                { name: "Alice", age: 30 },
                { name: "Bob", age: 25 },
            ];

            const csv = await collectStreamOutput((stream) =>
                generateCsvContent(stream, columns, rows),
            );
            const lines = csv.trim().split("\n");

            expect(lines).to.have.length(3);
            expect(lines[0]).to.equal('"Name","Age"');
            expect(lines[1]).to.equal('"Alice","30"');
            expect(lines[2]).to.equal('"Bob","25"');
        });

        test("should handle empty rows array", async () => {
            const columns = [{ field: "name", header: "Name" }];
            const rows: Array<{ name: string }> = [];

            const csv = await collectStreamOutput((stream) =>
                generateCsvContent(stream, columns, rows),
            );
            const lines = csv.trim().split("\n");

            expect(lines).to.have.length(1);
            expect(lines[0]).to.equal('"Name"');
        });

        test("should use custom field accessor when provided", async () => {
            interface CustomRow {
                data: Record<string, unknown>;
            }

            const columns = [
                { field: "firstName", header: "First Name" },
                { field: "lastName", header: "Last Name" },
            ];
            const rows: CustomRow[] = [
                { data: { firstName: "John", lastName: "Doe" } },
                { data: { firstName: "Jane", lastName: "Smith" } },
            ];

            const csv = await collectStreamOutput((stream) =>
                generateCsvContent(stream, columns, rows, (row, field) => row.data[field]),
            );
            const lines = csv.trim().split("\n");

            expect(lines).to.have.length(3);
            expect(lines[1]).to.equal('"John","Doe"');
            expect(lines[2]).to.equal('"Jane","Smith"');
        });

        test("should handle null/undefined field values", async () => {
            const columns = [
                { field: "name", header: "Name" },
                { field: "email", header: "Email" },
            ];
            const rows = [
                { name: "Alice", email: undefined },
                { name: getNullValue(), email: "bob@test.com" },
            ];

            const csv = await collectStreamOutput((stream) =>
                generateCsvContent(stream, columns, rows),
            );
            const lines = csv.trim().split("\n");

            expect(lines[1]).to.equal('"Alice",""');
            expect(lines[2]).to.equal('"","bob@test.com"');
        });

        test("should escape special characters in values", async () => {
            const columns = [{ field: "query", header: "SQL Query" }];
            const rows = [{ query: "SELECT * FROM \"users\" WHERE name = 'test'" }];

            const csv = await collectStreamOutput((stream) =>
                generateCsvContent(stream, columns, rows),
            );
            const lines = csv.trim().split("\n");

            expect(lines[1]).to.equal('"SELECT * FROM ""users"" WHERE name = \'test\'"');
        });

        test("should escape special characters in headers", async () => {
            const columns = [{ field: "value", header: 'Column "A"' }];
            const rows = [{ value: "test" }];

            const csv = await collectStreamOutput((stream) =>
                generateCsvContent(stream, columns, rows),
            );
            const lines = csv.trim().split("\n");

            expect(lines[0]).to.equal('"Column ""A"""');
        });
    });
});
