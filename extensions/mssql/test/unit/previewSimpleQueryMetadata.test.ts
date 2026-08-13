/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { SimpleQueryExecutor, SimpleQueryResult } from "@vscode-mssql/tsql-language-service";
import { VscodeMssqlSimpleQueryMetadataLoader } from "../../src/languageservice/preview/simpleQueryMetadata";
import {
    computeSingleTextChange,
    isPreviewStatsCodeLensEnabled,
} from "../../src/languageservice/preview/previewLanguageService";

suite("Preview language service integration", () => {
    test("projects simple-query rows into one immutable catalog input", async () => {
        const queries: string[] = [];
        const executor: SimpleQueryExecutor = {
            execute: async (query) => {
                queries.push(query);
                return resultFor(query);
            },
        };
        const input = await new VscodeMssqlSimpleQueryMetadataLoader().load(executor);

        expect(input.environment).to.deep.include({
            currentDatabase: "LargeDb",
            defaultSchema: "custom",
            caseSensitive: false,
            compatibilityLevel: 170,
        });
        expect(input.databases).to.deep.equal([{ name: "LargeDb" }]);
        expect(input.schemas).to.deep.equal([{ database: "LargeDb", name: "dbo" }]);
        expect(input.objects).to.have.length(1);
        expect(input.objects![0]).to.deep.include({
            schema: "dbo",
            name: "Customers",
            kind: "table",
        });
        expect(input.columns!.get("LargeDb:42")).to.deep.equal([
            {
                name: "Name",
                typeDisplay: "nvarchar(100)",
                nullable: true,
                identity: undefined,
                computed: undefined,
            },
        ]);
        expect(input.parameters!.get("LargeDb:42")).to.deep.equal([
            { ordinal: 1, name: "@id", typeDisplay: "int", output: false },
        ]);
        expect(input.completeness).to.deep.include({
            databases: "ready",
            schemas: "ready",
            objects: "ready",
            columns: "ready",
            parameters: "ready",
            definitions: "unknown",
        });
        expect(queries).to.have.length(6);
        for (const query of queries) {
            for (const line of query.split(/\r?\n/)) {
                if (/\b(?:FROM|JOIN)\s+sys\./i.test(line)) {
                    expect(line, `catalog read must use NOLOCK: ${line}`).to.match(
                        /\bWITH\s*\(NOLOCK\)/i,
                    );
                }
            }
        }
    });

    test("computes an equivalent minimal UTF-16 edit", () => {
        const previous = "SELECT N'😀';\nSELECT 1;";
        const next = "SELECT N'😀';\nSELECT dbo.Customers;";
        const change = computeSingleTextChange(previous, next)!;

        expect(previous.slice(0, change.start) + change.text + previous.slice(change.end)).to.equal(
            next,
        );
        expect(change.start).to.equal(previous.lastIndexOf("1"));
        expect(change.end).to.equal(previous.lastIndexOf("1") + 1);
    });

    test("requires both preview flags before showing the stats CodeLens", () => {
        expect(isPreviewStatsCodeLensEnabled(false, false)).to.equal(false);
        expect(isPreviewStatsCodeLensEnabled(true, false)).to.equal(false);
        expect(isPreviewStatsCodeLensEnabled(false, true)).to.equal(false);
        expect(isPreviewStatsCodeLensEnabled(true, true)).to.equal(true);
    });
});

function resultFor(query: string): SimpleQueryResult {
    if (query.includes("SERVERPROPERTY")) {
        return table(
            [
                "current_database",
                "default_schema",
                "case_sensitive",
                "engine_edition",
                "server_version",
                "compatibility_level",
            ],
            [["LargeDb", "custom", "0", "3", "17.0", "170"]],
        );
    }
    if (query.includes("FROM sys.databases") && query.includes("HAS_DBACCESS")) {
        return table(["database_name"], [["LargeDb"]]);
    }
    if (query.includes("FROM sys.schemas")) {
        return table(["schema_name"], [["dbo"]]);
    }
    if (query.includes("FROM sys.columns")) {
        return table(
            [
                "object_id",
                "column_id",
                "column_name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_nullable",
                "is_identity",
                "is_computed",
            ],
            [["42", "1", "Name", "nvarchar", "200", "0", "0", "1", "0", "0"]],
        );
    }
    if (query.includes("FROM sys.parameters")) {
        return table(
            [
                "object_id",
                "parameter_id",
                "parameter_name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_output",
            ],
            [["42", "1", "@id", "int", "4", "10", "0", "0"]],
        );
    }
    if (query.includes("FROM sys.objects")) {
        return table(
            ["object_id", "schema_name", "object_name", "object_type"],
            [["42", "dbo", "Customers", "U"]],
        );
    }
    throw new Error(`Unexpected metadata query: ${query}`);
}

function table(
    columns: readonly string[],
    rows: readonly (readonly string[])[],
): SimpleQueryResult {
    return { columns: columns.map((name) => ({ name })), rows };
}
