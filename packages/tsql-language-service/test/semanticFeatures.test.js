/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    DocumentSchemaEvolution,
    GrammarCompletionService,
    SemanticDefinitionService,
    SemanticHoverService,
    SemanticNavigationIndex,
    semanticObjectIdentity,
} = require("../dist/semantic/index.js");

describe("semantic editor feature strategies", () => {
    const document = DocumentSchemaEvolution.fromText(
        `
        CREATE TABLE dbo.Users (Id INT NOT NULL, Name NVARCHAR(100) NULL);
        CREATE PROCEDURE dbo.SaveUser @Id INT AS SELECT @Id;
    `,
        { uri: "file:///local.sql" },
    );
    const catalog = {
        version: 4,
        world: "closed",
        columnsFor(parts) {
            return parts.at(-1).toLowerCase() === "orders"
                ? [{ name: "OrderId", type: "bigint", nullable: false }]
                : parts.at(-1).toLowerCase() === "users"
                  ? [{ name: "RemoteOnly", type: "int" }]
                  : undefined;
        },
        objectFor(parts) {
            if (parts.at(-1).toLowerCase() !== "orders") return undefined;
            return {
                parts: ["dbo", "Orders"],
                kind: "table",
                columns: this.columnsFor(parts),
            };
        },
        tableCandidates() {
            return [
                ["dbo", "Users"],
                ["dbo", "Orders"],
            ];
        },
        childrenOf(prefix) {
            return prefix.length === 0
                ? [{ name: "dbo", kind: "namespace" }]
                : [{ name: "Orders", kind: "table" }];
        },
    };

    it("uses grammar context and visible parser sources for qualified completion", () => {
        let contextCalls = 0;
        const parser = {
            completionContextAt(offset) {
                contextCalls++;
                assert.equal(offset, 12);
                return {
                    kind: "qualifiedMember",
                    prefix: "u.Na",
                    qualifier: "u",
                    replaceSpan: { start: 10, end: 12 },
                    expectedKeywords: ["WHERE"],
                    visibleSources: [{ name: "Users", alias: "u", objectParts: ["dbo", "Users"] }],
                };
            },
        };

        const result = new GrammarCompletionService().complete({
            parser,
            offset: 12,
            document,
            catalog,
        });
        assert.equal(contextCalls, 1);
        assert.deepEqual(result.replaceSpan, { start: 10, end: 12 });
        assert.deepEqual(result.items, [
            { label: "Name", kind: "column", detail: "NVARCHAR(100) NULL" },
        ]);
    });

    it("deduplicates local/catalog objects while local DDL shadows the catalog", () => {
        const parser = {
            completionContextAt() {
                return {
                    kind: "object",
                    prefix: "Us",
                    replaceSpan: { start: 0, end: 2 },
                    expectedKeywords: ["FROM"],
                };
            },
        };
        const result = new GrammarCompletionService().complete({
            parser,
            offset: 2,
            document,
            catalog,
        });

        assert.deepEqual(result.items, [{ label: "dbo.Users", kind: "table", detail: "table" }]);
        assert.deepEqual(
            document.columnsFor(["Users"]).map((column) => column.name),
            ["Id", "Name"],
        );
    });

    it("uses grammar-provided keywords and namespace prefixes without text heuristics", () => {
        const completion = new GrammarCompletionService();
        const keyword = completion.complete({
            parser: {
                completionContextAt() {
                    return {
                        kind: "unknown",
                        prefix: "wh",
                        replaceSpan: { start: 0, end: 2 },
                        expectedKeywords: ["WHERE", "WHEN"],
                    };
                },
            },
            offset: 2,
            document,
            catalog,
        });
        const namespace = completion.complete({
            parser: {
                completionContextAt() {
                    return {
                        kind: "namespace",
                        prefix: "dbo.",
                        replaceSpan: { start: 0, end: 4 },
                    };
                },
            },
            offset: 4,
            document,
            catalog,
        });

        assert.deepEqual(
            keyword.items.map((item) => item.label),
            ["WHEN", "WHERE"],
        );
        assert.deepEqual(
            namespace.items.map((item) => item.label),
            ["Orders", "SaveUser", "Users"],
        );
    });

    it("emits structured object, column, alias, and routine hover information", () => {
        const targets = [
            {
                kind: "column",
                name: "Name",
                columnName: "Name",
                alias: "u",
                objectParts: ["dbo", "Users"],
                span: { start: 0, end: 4 },
            },
            {
                kind: "alias",
                name: "u",
                alias: "u",
                source: { name: "Users", alias: "u", objectParts: ["dbo", "Users"] },
                span: { start: 5, end: 6 },
            },
            {
                kind: "routine",
                name: "SaveUser",
                objectParts: ["dbo", "SaveUser"],
                span: { start: 7, end: 15 },
            },
        ];
        let index = 0;
        const parser = {
            completionContextAt() {
                return undefined;
            },
            hoverTargetAt() {
                return targets[index++];
            },
        };
        const hover = new SemanticHoverService();

        const column = hover.hover({ parser, offset: 1, document, catalog });
        assert.equal(column.type, "NVARCHAR(100)");
        assert.equal(column.nullable, true);
        assert.match(column.markdown, /Alias: `u`/);
        const alias = hover.hover({ parser, offset: 5, document, catalog });
        assert.match(alias.markdown, /dbo\.Users/);
        const routine = hover.hover({ parser, offset: 10, document, catalog });
        assert.equal(routine.kind, "routine");
        assert.match(routine.signature, /@Id INT/);
    });

    it("keeps references and definitions keyed by stable identity and calls scripting only when local navigation misses", async () => {
        const users = semanticObjectIdentity("table", ["dbo", "Users"]);
        const remote = semanticObjectIdentity("procedure", ["dbo", "RemoteProcedure"]);
        const snapshot = {
            completionContextAt() {
                return undefined;
            },
            occurrences() {
                return [
                    {
                        identity: users,
                        role: "declaration",
                        span: { start: 0, end: 5 },
                        uri: "file:///local.sql",
                    },
                    {
                        identity: users,
                        role: "reference",
                        span: { start: 20, end: 25 },
                        uri: "file:///local.sql",
                    },
                    {
                        identity: remote,
                        role: "reference",
                        span: { start: 30, end: 35 },
                        uri: "file:///local.sql",
                    },
                ];
            },
        };
        let externalCalls = 0;
        const service = new SemanticDefinitionService(
            SemanticNavigationIndex.fromSnapshot(snapshot),
            {
                async resolveDefinition(request) {
                    externalCalls++;
                    assert.equal(request.identity.key, remote.key);
                    return { uri: "mssql://script/remote", span: { start: 1, end: 2 } };
                },
            },
        );

        assert.deepEqual(service.referencesAt(21), {
            identity: users,
            declaration: { uri: "file:///local.sql", span: { start: 0, end: 5 } },
            references: [{ uri: "file:///local.sql", span: { start: 20, end: 25 } }],
        });
        assert.deepEqual(await service.definitionAt(21), {
            uri: "file:///local.sql",
            span: { start: 0, end: 5 },
        });
        assert.equal(externalCalls, 0);
        assert.deepEqual(await service.definitionAt(31), {
            uri: "mssql://script/remote",
            span: { start: 1, end: 2 },
        });
        assert.equal(externalCalls, 1);
    });
});
