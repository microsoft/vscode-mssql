/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Cloud Deploy schema hasher (Scope 2, decision D-A):
 *   * `hashSchemaFiles` is deterministic and order-independent.
 *   * line-ending and BOM differences do NOT change the hash (local↔CI bridge).
 *   * a content change, a path change, or an added file DOES change the hash.
 *   * `hashDacpacBytes` fingerprints raw bytes (no normalization).
 *   * `SchemaHasher` dispatches SqlProj → file hashing and Dacpac → byte hashing,
 *     and rejects unsupported source-of-truth kinds.
 *   * `normalizePath` / `normalizeLineEndings` helper behavior.
 */

import { expect } from "chai";

import { SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import {
    hashDacpacBytes,
    hashSchemaFiles,
    normalizeLineEndings,
    normalizePath,
    SchemaFile,
    SchemaHasher,
    SchemaHashUnsupportedError,
    SchemaSourceReader,
} from "../../src/cloudDeploy/runs/schemaHasher";

function file(relativePath: string, content: string): SchemaFile {
    return { relativePath, content: Buffer.from(content, "utf-8") };
}

suite("CloudDeploy SchemaHasher", () => {
    suite("hashSchemaFiles", () => {
        test("is deterministic for the same input", () => {
            const files = [file("Tables/Messages.sql", "CREATE TABLE Messages (Id INT);")];
            expect(hashSchemaFiles(files).hash).to.equal(hashSchemaFiles(files).hash);
        });

        test("stamps the algorithm and a sha256: prefix", () => {
            const result = hashSchemaFiles([file("a.sql", "SELECT 1;")]);
            expect(result.algorithm).to.equal("sha256");
            expect(result.hash).to.match(/^sha256:[0-9a-f]{64}$/);
        });

        test("is independent of input file order", () => {
            const a = file("Tables/A.sql", "CREATE TABLE A (Id INT);");
            const b = file("Tables/B.sql", "CREATE TABLE B (Id INT);");
            expect(hashSchemaFiles([a, b]).hash).to.equal(hashSchemaFiles([b, a]).hash);
        });

        test("ignores CRLF vs LF differences (Windows↔CI bridge)", () => {
            const lf = hashSchemaFiles([file("a.sql", "line1\nline2\n")]);
            const crlf = hashSchemaFiles([file("a.sql", "line1\r\nline2\r\n")]);
            expect(crlf.hash).to.equal(lf.hash);
        });

        test("ignores a leading UTF-8 BOM", () => {
            const withBom = hashSchemaFiles([file("a.sql", "\uFEFFSELECT 1;")]);
            const withoutBom = hashSchemaFiles([file("a.sql", "SELECT 1;")]);
            expect(withBom.hash).to.equal(withoutBom.hash);
        });

        test("treats backslash and forward-slash paths as identical", () => {
            const back = hashSchemaFiles([file("Tables\\A.sql", "X")]);
            const forward = hashSchemaFiles([file("Tables/A.sql", "X")]);
            expect(back.hash).to.equal(forward.hash);
        });

        test("changes when file content changes", () => {
            const before = hashSchemaFiles([file("a.sql", "SELECT 1;")]);
            const after = hashSchemaFiles([file("a.sql", "SELECT 2;")]);
            expect(after.hash).to.not.equal(before.hash);
        });

        test("changes when a file is renamed (path is part of the hash)", () => {
            const before = hashSchemaFiles([file("a.sql", "SELECT 1;")]);
            const after = hashSchemaFiles([file("b.sql", "SELECT 1;")]);
            expect(after.hash).to.not.equal(before.hash);
        });

        test("changes when a file is added", () => {
            const one = hashSchemaFiles([file("a.sql", "SELECT 1;")]);
            const two = hashSchemaFiles([file("a.sql", "SELECT 1;"), file("b.sql", "SELECT 2;")]);
            expect(two.hash).to.not.equal(one.hash);
        });

        test("does not collide when a path/content boundary shifts", () => {
            // Without NUL separators, "ab"+"c" and "a"+"bc" could collide.
            const left = hashSchemaFiles([file("ab", "c")]);
            const right = hashSchemaFiles([file("a", "bc")]);
            expect(left.hash).to.not.equal(right.hash);
        });
    });

    suite("hashDacpacBytes", () => {
        test("is deterministic for the same bytes", () => {
            const bytes = Buffer.from([0x01, 0x02, 0x03]);
            expect(hashDacpacBytes(bytes).hash).to.equal(hashDacpacBytes(bytes).hash);
        });

        test("changes when the bytes change", () => {
            const a = hashDacpacBytes(Buffer.from([0x01, 0x02]));
            const b = hashDacpacBytes(Buffer.from([0x01, 0x03]));
            expect(b.hash).to.not.equal(a.hash);
        });

        test("does NOT normalize line endings (binary artifact)", () => {
            const lf = hashDacpacBytes(Buffer.from("a\nb", "utf-8"));
            const crlf = hashDacpacBytes(Buffer.from("a\r\nb", "utf-8"));
            expect(crlf.hash).to.not.equal(lf.hash);
        });
    });

    suite("SchemaHasher", () => {
        class FakeReader implements SchemaSourceReader {
            public constructor(
                private readonly _files: SchemaFile[] = [],
                private readonly _bytes: Buffer = Buffer.alloc(0),
            ) {}
            public listedDirectory: string | undefined;
            public readPath: string | undefined;

            public async listSqlProjFiles(projectDirectory: string): Promise<SchemaFile[]> {
                this.listedDirectory = projectDirectory;
                return this._files;
            }
            public async readFileBuffer(filePath: string): Promise<Buffer> {
                this.readPath = filePath;
                return this._bytes;
            }
        }

        test("hashes SqlProj source files and lists the project directory", async () => {
            const reader = new FakeReader([file("Tables/A.sql", "CREATE TABLE A (Id INT);")]);
            const hasher = new SchemaHasher(reader);

            const result = await hasher.hash({
                kind: SourceOfTruthKind.SqlProj,
                path: "db/MyProject/MyProject.sqlproj",
            });

            expect(reader.listedDirectory).to.equal("db/MyProject");
            expect(result.hash).to.match(/^sha256:[0-9a-f]{64}$/);
        });

        test("hashes the dacpac bytes for a Dacpac source", async () => {
            const reader = new FakeReader([], Buffer.from([0x09, 0x08, 0x07]));
            const hasher = new SchemaHasher(reader);

            const result = await hasher.hash({
                kind: SourceOfTruthKind.Dacpac,
                path: "db/out/MyProject.dacpac",
            });

            expect(reader.readPath).to.equal("db/out/MyProject.dacpac");
            expect(result.hash).to.equal(hashDacpacBytes(Buffer.from([0x09, 0x08, 0x07])).hash);
        });

        test("rejects an unsupported source-of-truth kind", async () => {
            const hasher = new SchemaHasher(new FakeReader());
            let caught: unknown;
            try {
                // No unsupported kind exists in the union today (sqlproj + dacpac
                // are both handled), so cast a bogus kind to exercise the
                // defensive exhaustive guard.
                await hasher.hash({ kind: "mystery", path: "x" } as unknown as Parameters<
                    SchemaHasher["hash"]
                >[0]);
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(SchemaHashUnsupportedError);
        });
    });

    suite("helpers", () => {
        test("normalizePath converts backslashes and strips leading ./", () => {
            expect(normalizePath("Tables\\A.sql")).to.equal("Tables/A.sql");
            expect(normalizePath("./Tables/A.sql")).to.equal("Tables/A.sql");
        });

        test("normalizeLineEndings collapses CRLF and CR to LF", () => {
            expect(normalizeLineEndings(Buffer.from("a\r\nb\rc")).toString("utf-8")).to.equal(
                "a\nb\nc",
            );
        });

        test("normalizeLineEndings strips a leading BOM", () => {
            expect(normalizeLineEndings(Buffer.from("\uFEFFhi")).toString("utf-8")).to.equal("hi");
        });
    });
});
