/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as api from "../../../../src/index.ts";
import type {
    IndexMetadata,
    InMemoryMetadataInput,
    MetadataLoadState,
    MetadataSectionState,
    ObjectMetadata,
    SemanticSnapshot,
} from "../../../../src/index.ts";

type UnloadedIndexState = Exclude<
    MetadataLoadState<readonly IndexMetadata[]>,
    { readonly kind: "loaded" }
>;
// CREATE INDEX is validated against the target object's existing index set. Every result needs an
// authoritative fact: a resolved target and, for the name and clustering rules, a loaded index set.
// Anything else — pending, partial, stale, failed, or an object created in this document — means
// unknown and produces no diagnostic.
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = api;

const object = (
    id: string,
    name: string,
    kind: ObjectMetadata["kind"],
    extra: Partial<ObjectMetadata> = {},
): ObjectMetadata => ({
    ref: { id, database: "db" },
    database: "db",
    schema: "dbo",
    name,
    kind,
    ...extra,
});

const catalog = {
    environment: { currentDatabase: "db", defaultSchema: "dbo" },
    schemas: [{ database: "db", name: "dbo" }],
    databases: [{ name: "db" }],
    objects: [
        object("t", "t", "table"),
        object("bound", "BoundView", "view", { schemaBound: true }),
        object("loose", "LooseView", "view", { schemaBound: false }),
        object("unknownBinding", "UnknownView", "view"),
        object("xmlView", "XmlView", "view", { schemaBound: true }),
    ],
    columns: new Map([
        [
            "t",
            [
                { name: "a", typeDisplay: "int" },
                { name: "b", typeDisplay: "int" },
                { name: "Notes", typeDisplay: "nvarchar(max)" },
            ],
        ],
        ["bound", [{ name: "a", typeDisplay: "int" }]],
        ["loose", [{ name: "a", typeDisplay: "int" }]],
        ["unknownBinding", [{ name: "a", typeDisplay: "int" }]],
        [
            "xmlView",
            [
                { name: "a", typeDisplay: "int" },
                { name: "Payload", typeDisplay: "xml" },
            ],
        ],
    ]),
    indexes: new Map([
        [
            "t",
            [
                { name: "IX_a", kind: "relational", clustered: false },
                { name: "CIX_t", kind: "relational", clustered: true },
                { name: "XIX_t", kind: "xml" },
                { name: "ST_t", kind: "relational", statistics: true },
            ],
        ],
        ["bound", []],
        ["loose", []],
        ["unknownBinding", []],
        ["xmlView", []],
    ]),
} satisfies InMemoryMetadataInput;

interface AnalyzePatch extends InMemoryMetadataInput {
    readonly allowSyntaxDiagnostics?: boolean;
}

async function analyze(sql: string, patch: AnalyzePatch = {}) {
    const { allowSyntaxDiagnostics = false, ...metadataPatch } = patch;
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider({ ...catalog, ...metadataPatch }),
    );
    const snapshot = await runtime.open("file:///index-catalog.sql", 1, sql);
    if (!allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics.map(({ code, message, severity, range }) => ({
        code,
        message,
        severity,
        text: sql.slice(range.start, range.end),
    }));
}

const codes = (diagnostics: readonly { readonly code: string }[]): string[] =>
    diagnostics.map(({ code }) => code);

/** Every family this suite owns, used where an unrelated validation also fires. */
const indexCatalogCodes = new Set([
    "CannotConvertClusteredIndexToNonclustered",
    "CannotConvertXmlOrSpatialIndexToRelational",
    "CannotCreateIndexOnViewContainsInvalidColumns",
    "CannotCreateIndexOnViewDoesNotHaveUniqueClusteredIndex",
    "CannotCreateIndexOnViewNotSchemaBound",
    "CannotCreateNonuniqueClusteredIndexOnView",
    "ClusteredIndexExists",
    "ColumnIsInvalidForUseAsOrderColumnInIndex",
    "CouldNotFindIndex",
    "IndexOrStatisticsExists",
    "OnlineOperationCannotBePerformedOnIndexInvalidColumns",
]);

suite("T-SQL index catalog validation", () => {
    // Exact output for a name that already exists on the target object.
    test("reports an existing index name with exact output", async () => {
        assert.deepEqual(await analyze("CREATE INDEX IX_a ON dbo.t (a);"), [
            {
                code: "IndexOrStatisticsExists",
                message:
                    "The index or statistics with name 'IX_a' already exists on table or view 'dbo.t'.",
                severity: "error",
                text: "IX_a",
            },
        ]);
    });

    // A statistics object shares the index namespace, so it also blocks the name.
    test("treats a statistics object as an existing index name", async () => {
        assert.deepEqual(codes(await analyze("CREATE INDEX ST_t ON dbo.t (a);")), [
            "IndexOrStatisticsExists",
        ]);
    });

    // The exact output for each DROP_EXISTING replacement rule.
    test("reports each DROP_EXISTING replacement failure with exact output", async () => {
        assert.deepEqual(
            await analyze("CREATE INDEX IX_missing ON dbo.t (a) WITH (DROP_EXISTING = ON);"),
            [
                {
                    code: "CouldNotFindIndex",
                    message: "Could not find any index named 'IX_missing' for table 'dbo.t'.",
                    severity: "error",
                    text: "IX_missing",
                },
            ],
        );
        assert.deepEqual(
            await analyze("CREATE INDEX XIX_t ON dbo.t (a) WITH (DROP_EXISTING = ON);"),
            [
                {
                    code: "CannotConvertXmlOrSpatialIndexToRelational",
                    message:
                        "Could not convert the XML or spatial index 'XIX_t' to a relational index by using the DROP_EXISTING option.  Drop the XML or spatial index and create a relational index with the same name.",
                    severity: "error",
                    text: "XIX_t",
                },
            ],
        );
        assert.deepEqual(
            await analyze(
                "CREATE NONCLUSTERED INDEX CIX_t ON dbo.t (a) WITH (DROP_EXISTING = ON);",
            ),
            [
                {
                    code: "CannotConvertClusteredIndexToNonclustered",
                    message:
                        "Cannot convert a clustered index to a nonclustered index by using the DROP_EXISTING option. To change the index type from clustered to nonclustered, delete the clustered index, and then create a nonclustered index by using two separate statements.",
                    severity: "error",
                    text: "CIX_t",
                },
            ],
        );
    });

    // A replacement that keeps the clustering, and a spatial index replaced by name, are valid.
    test("accepts a supported DROP_EXISTING replacement", async () => {
        for (const sql of [
            "CREATE INDEX IX_a ON dbo.t (a) WITH (DROP_EXISTING = ON);",
            "CREATE CLUSTERED INDEX CIX_t ON dbo.t (a) WITH (DROP_EXISTING = ON);",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
        // Replacing a nonclustered index with a clustered one is a supported conversion, but the
        // object's other clustered index still occupies the only clustered slot.
        assert.deepEqual(
            codes(
                await analyze(
                    "CREATE CLUSTERED INDEX IX_a ON dbo.t (a) WITH (DROP_EXISTING = ON);",
                ),
            ),
            ["ClusteredIndexExists"],
        );
    });

    // A bare DROP_EXISTING replaces, and DROP_EXISTING = OFF creates, so each takes its own path.
    test("separates the DROP_EXISTING option values", async () => {
        assert.deepEqual(
            codes(await analyze("CREATE INDEX IX_a ON dbo.t (a) WITH (DROP_EXISTING);")),
            [],
        );
        assert.deepEqual(
            codes(await analyze("CREATE INDEX IX_a ON dbo.t (a) WITH (DROP_EXISTING = OFF);")),
            ["IndexOrStatisticsExists"],
        );
    });

    // A second clustered index names the one that already occupies the slot.
    test("reports an existing clustered index with exact output", async () => {
        assert.deepEqual(await analyze("CREATE CLUSTERED INDEX CIX_new ON dbo.t (a);"), [
            {
                code: "ClusteredIndexExists",
                message:
                    "Cannot create more than one clustered index on view 'dbo.t'. Drop the existing clustered index 'CIX_t' before creating another.",
                severity: "error",
                text: "CIX_new",
            },
        ]);
        // Replacing the clustered index itself frees the slot, so the same shape is valid.
        assert.deepEqual(
            codes(
                await analyze(
                    "CREATE CLUSTERED INDEX CIX_t ON dbo.t (a) WITH (DROP_EXISTING = ON);",
                ),
            ),
            [],
        );
    });

    // A large-value included column can only build offline, which ONLINE = ON contradicts.
    test("reports an online build that must be offline with exact output", async () => {
        assert.deepEqual(
            await analyze("CREATE INDEX IX_new ON dbo.t (a) INCLUDE (Notes) WITH (ONLINE = ON);"),
            [
                {
                    code: "OnlineOperationCannotBePerformedOnIndexInvalidColumns",
                    message:
                        "An online operation cannot be performed for index 'IX_new' because the index contains columns of data type text, ntext, image, varchar(max), nvarchar(max), varbinary(max), xml, or large CLR type.",
                    severity: "error",
                    text: "IX_new",
                },
            ],
        );
        for (const sql of [
            "CREATE INDEX IX_new ON dbo.t (a) INCLUDE (Notes);",
            "CREATE INDEX IX_new ON dbo.t (a) INCLUDE (Notes) WITH (ONLINE = OFF);",
            "CREATE INDEX IX_new ON dbo.t (a) INCLUDE (b) WITH (ONLINE = ON);",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Unrelated statements against the same catalog stay silent.
    test("does not report unrelated statements", async () => {
        for (const sql of [
            "SELECT a FROM dbo.t;",
            "DROP INDEX IX_a ON dbo.t;",
            "ALTER INDEX IX_a ON dbo.t REBUILD;",
            "CREATE STATISTICS ST_new ON dbo.t (a);",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Damaged input never invents an index conflict or a follow-on catalog result.
    test("stays silent on malformed editor input", async () => {
        for (const sql of [
            "CREATE INDEX IX_a ON",
            "CREATE INDEX ON dbo.t (a);",
            "CREATE INDEX",
            "CREATE INDEX IX_a ON dbo.t (",
        ]) {
            assert.deepEqual(
                (await analyze(sql, { allowSyntaxDiagnostics: true })).filter(({ code }) =>
                    indexCatalogCodes.has(code),
                ),
                [],
                sql,
            );
        }
    });

    // Quoted and multipart target names resolve to the same object and message text.
    test("handles quoted and multipart names", async () => {
        assert.deepEqual(await analyze("CREATE INDEX [IX_a] ON [db].[dbo].[t] ([a]);"), [
            {
                code: "IndexOrStatisticsExists",
                message:
                    "The index or statistics with name 'IX_a' already exists on table or view '[db].[dbo].[t]'.",
                severity: "error",
                text: "[IX_a]",
            },
        ]);
    });
});

suite("T-SQL indexed view validation", () => {
    // A view's first clustered index must be unique.
    test("reports a nonunique clustered index on a view with exact output", async () => {
        assert.deepEqual(await analyze("CREATE CLUSTERED INDEX CIX ON dbo.BoundView (a);"), [
            {
                code: "CannotCreateNonuniqueClusteredIndexOnView",
                message:
                    "Cannot create nonunique clustered index on view 'dbo.BoundView' because only unique clustered indexes are allowed. Consider creating unique clustered index instead.",
                severity: "error",
                text: "CIX",
            },
        ]);
        assert.deepEqual(
            await analyze("CREATE UNIQUE CLUSTERED INDEX CIX ON dbo.BoundView (a);"),
            [],
        );
    });

    // Any additional index on a view requires an existing unique clustered index first.
    test("requires a unique clustered index before any other view index", async () => {
        assert.deepEqual(await analyze("CREATE INDEX IX ON dbo.BoundView (a);"), [
            {
                code: "CannotCreateIndexOnViewDoesNotHaveUniqueClusteredIndex",
                message:
                    "Cannot create index on view 'dbo.BoundView'. It does not have a unique clustered index.",
                severity: "error",
                text: "IX",
            },
        ]);
        assert.deepEqual(
            codes(
                await analyze("CREATE INDEX IX ON dbo.BoundView (a);", {
                    indexes: new Map<string, readonly IndexMetadata[]>([
                        ...catalog.indexes,
                        [
                            "bound",
                            [{ name: "CIX", kind: "relational", clustered: true, unique: true }],
                        ],
                    ]),
                }),
            ),
            [],
        );
    });

    // Only an explicit false proves a view is not schema bound.
    test("reports a view that is not schema bound with exact output", async () => {
        assert.deepEqual(await analyze("CREATE UNIQUE CLUSTERED INDEX CIX ON dbo.LooseView (a);"), [
            {
                code: "CannotCreateIndexOnViewNotSchemaBound",
                message:
                    "Cannot create index on view 'dbo.LooseView' because the view is not schema bound.",
                severity: "error",
                text: "dbo.LooseView",
            },
        ]);
        // A backend that cannot report schema binding must not become a false positive.
        assert.deepEqual(
            await analyze("CREATE UNIQUE CLUSTERED INDEX CIX ON dbo.UnknownView (a);"),
            [],
        );
    });

    // An indexed view may not project text, ntext, image, FILESTREAM, or xml columns.
    test("reports an ineligible view projection with exact output", async () => {
        assert.deepEqual(
            (await analyze("CREATE UNIQUE CLUSTERED INDEX CIX ON dbo.XmlView (a);")).filter(
                ({ code }) => code === "CannotCreateIndexOnViewContainsInvalidColumns",
            ),
            [
                {
                    code: "CannotCreateIndexOnViewContainsInvalidColumns",
                    message:
                        "Cannot create index on view 'dbo.XmlView'. It contains text, ntext, image, FILESTREAM or xml columns.",
                    severity: "error",
                    text: "dbo.XmlView",
                },
            ],
        );
        // The same projection without the ineligible column stays silent.
        assert.deepEqual(
            await analyze("CREATE UNIQUE CLUSTERED INDEX CIX ON dbo.XmlView (a);", {
                columns: new Map([
                    ...catalog.columns,
                    ["xmlView", [{ name: "a", typeDisplay: "int" }]],
                ]),
            }),
            [],
        );
    });

    // A table target never receives the indexed-view rules.
    test("does not apply view rules to a table", async () => {
        assert.deepEqual(codes(await analyze("CREATE INDEX IX_new ON dbo.t (a);")), []);
    });
});

suite("T-SQL columnstore order column validation", () => {
    // A nonclustered index can only order a column it already stores.
    test("reports an unstored order column with exact output", async () => {
        assert.deepEqual(
            await analyze("CREATE NONCLUSTERED COLUMNSTORE INDEX NCI ON dbo.t (a) ORDER (b);"),
            [
                {
                    code: "ColumnIsInvalidForUseAsOrderColumnInIndex",
                    message:
                        "Column 'b' in table 't' is of a type that is invalid for use as an order column in an index.",
                    severity: "error",
                    text: "b",
                },
            ],
        );
    });

    // A clustered columnstore index stores every column, and a stored column is always orderable.
    test("accepts every valid order column", async () => {
        for (const sql of [
            "CREATE CLUSTERED COLUMNSTORE INDEX CCI ON dbo.BoundView ORDER (a);",
            "CREATE NONCLUSTERED COLUMNSTORE INDEX NCI ON dbo.t (a, b) ORDER (a DESC, b);",
            "CREATE NONCLUSTERED COLUMNSTORE INDEX NCI ON dbo.t (a) INCLUDE (b) ORDER (b);",
            "CREATE CLUSTERED COLUMNSTORE INDEX CCI ON dbo.t ORDER (Notes);",
        ]) {
            assert.deepEqual(
                codes(await analyze(sql)).filter(
                    (code) => code === "ColumnIsInvalidForUseAsOrderColumnInIndex",
                ),
                [],
                sql,
            );
        }
    });

    // Order columns are checked against the target and against each other before the stored set.
    test("reports missing and repeated order columns first", async () => {
        assert.deepEqual(
            codes(
                await analyze(
                    "CREATE NONCLUSTERED COLUMNSTORE INDEX NCI ON dbo.t (a) ORDER (missing);",
                ),
            ),
            ["ColumnNameNotInTargetTable"],
        );
        assert.deepEqual(
            codes(
                await analyze(
                    "CREATE NONCLUSTERED COLUMNSTORE INDEX NCI ON dbo.t (a) ORDER (a, [a]);",
                ),
            ),
            ["DuplicateColumnNamesInIndex"],
        );
    });
});

suite("T-SQL index catalog completeness", () => {
    // No index-set state other than loaded proves which indexes exist.
    test("never reports from an unloaded index set", async () => {
        const states: readonly UnloadedIndexState["kind"][] = ["loading", "notLoaded", "failed"];
        for (const state of states) {
            assert.deepEqual(
                await analyze("CREATE INDEX IX_a ON dbo.t (a);", {
                    indexStates: new Map([["t", { kind: state }]]),
                }),
                [],
                state,
            );
            assert.deepEqual(
                await analyze("CREATE INDEX IX_new ON dbo.t (a) WITH (DROP_EXISTING = ON);", {
                    indexStates: new Map([["t", { kind: state }]]),
                }),
                [],
                state,
            );
        }
    });

    // A section that is not ready and carries no per-object entry is unknown, not empty.
    test("never reports from an incomplete index section", async () => {
        const states: readonly MetadataSectionState[] = [
            "loading",
            "partial",
            "stale",
            "unknown",
            "failed",
        ];
        for (const indexes of states) {
            assert.deepEqual(
                await analyze("CREATE INDEX IX_new ON dbo.t (a) WITH (DROP_EXISTING = ON);", {
                    indexes: new Map(),
                    completeness: { indexes },
                }),
                [],
                indexes,
            );
        }
    });

    // A failed refresh that retained a prior value is still not authoritative.
    test("never reports from a failed state that kept prior data", async () => {
        assert.deepEqual(
            await analyze("CREATE INDEX IX_a ON dbo.t (a);", {
                indexStates: new Map([
                    ["t", { kind: "failed", previous: [{ name: "IX_a", kind: "relational" }] }],
                ]),
            }),
            [],
        );
    });

    // An object created in this document is newer than any catalog generation, and so is its
    // index set, so a name that clashes in the catalog is not a conflict here.
    test("never reports against a table created in this document", async () => {
        assert.deepEqual(
            await analyze(`CREATE TABLE dbo.Fresh (a int);
CREATE INDEX IX_a ON dbo.Fresh (a);`),
            [],
        );
        // The same holds after the catalog object is dropped in this document.
        assert.deepEqual(
            (
                await analyze(`DROP TABLE dbo.t;
CREATE INDEX IX_a ON dbo.t (a);`)
            ).filter(({ code }) => indexCatalogCodes.has(code)),
            [],
        );
    });

    // A target the catalog cannot resolve carries no index set, so nothing is reported.
    test("does not add an index result for an unresolved target", async () => {
        assert.deepEqual(
            (await analyze("CREATE INDEX IX_a ON dbo.missing (a);")).filter(({ code }) =>
                indexCatalogCodes.has(code),
            ),
            [],
        );
    });
});

suite("T-SQL index catalog incremental equivalence", () => {
    // Incremental analysis of the same final text and generation must equal a fresh analysis.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const uri = "file:///index-incremental.sql";
        const first = "SELECT 1;\nGO\nCREATE INDEX IX_new ON dbo.t (a);\n";
        const final = "SELECT 1;\nGO\nCREATE INDEX IX_a ON dbo.t (a);\n";
        const initialSyntax = service.parse(new ImmutableTextSnapshot(uri, 1, first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        assert.deepEqual(initial.diagnostics, []);
        const change = {
            start: first.indexOf("IX_new"),
            end: first.indexOf("IX_new") + "IX_new".length,
            text: "IX_a",
        };
        const updatedSyntax = service.update(
            initialSyntax,
            new ImmutableTextSnapshot(uri, 2, final),
            [change],
        );
        const updated = binder.update(initial, {
            syntax: updatedSyntax,
            metadata: provider.pin(),
            previous: initial,
            changedRanges: updatedSyntax.changedRanges,
        });
        const fresh = binder.bind({
            syntax: service.parse(new ImmutableTextSnapshot(uri, 2, final)),
            metadata: provider.pin(),
        });
        const normalize = (snapshot: SemanticSnapshot): string[] =>
            snapshot.diagnostics
                .map(({ code, message, range }) => `${code}:${range.start}:${range.end}:${message}`)
                .sort();
        assert.deepEqual(normalize(updated), normalize(fresh));
        assert.deepEqual(normalize(fresh).length, 1);
    });
});
