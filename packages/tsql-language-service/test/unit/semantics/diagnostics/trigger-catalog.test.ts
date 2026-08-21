/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as api from "../../../../src/index.ts";
import type {
    ForeignKeyMetadata,
    InMemoryMetadataInput,
    MetadataLoadState,
    ObjectMetadata,
    SemanticSnapshot,
    TriggerMetadata,
} from "../../../../src/index.ts";

type UnloadedTriggerState = Exclude<
    MetadataLoadState<readonly TriggerMetadata[]>,
    { readonly kind: "loaded" }
>;
type UnloadedForeignKeyState = Exclude<
    MetadataLoadState<readonly ForeignKeyMetadata[]>,
    { readonly kind: "loaded" }
>;
// A DML trigger lives in its own schema and is attached to one table or view. The create path
// compares those schemas; the alter path compares the object the trigger is attached to with the
// declared target. Duplicate-activation and cascade rules additionally require the statement to be
// one the engine would carry out, and every catalog fact behind them must be loaded.
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = api;

const object = (
    id: string,
    schema: string,
    name: string,
    kind: ObjectMetadata["kind"],
    extra: Partial<ObjectMetadata> = {},
): ObjectMetadata => ({
    ref: { id, database: "db" },
    database: "db",
    schema,
    name,
    kind,
    ...extra,
});

const catalog = {
    environment: { currentDatabase: "db", defaultSchema: "dbo" },
    schemas: [
        { database: "db", name: "dbo" },
        { database: "db", name: "sales" },
    ],
    databases: [{ name: "db" }],
    objects: [
        object("t", "dbo", "Orders", "table"),
        object("salesOrders", "sales", "Orders", "table"),
        object("plain", "dbo", "PlainView", "view"),
        object("checked", "dbo", "CheckedView", "view", { checkOption: true }),
        object("unknownCheck", "dbo", "UnknownView", "view"),
        object("cascade", "dbo", "Cascading", "table"),
    ],
    columns: new Map([
        ["t", [{ name: "Id", typeDisplay: "int" }]],
        ["salesOrders", [{ name: "Id", typeDisplay: "int" }]],
        ["plain", [{ name: "Id", typeDisplay: "int" }]],
        ["checked", [{ name: "Id", typeDisplay: "int" }]],
        ["unknownCheck", [{ name: "Id", typeDisplay: "int" }]],
        ["cascade", [{ name: "Id", typeDisplay: "int" }]],
    ]),
    triggers: new Map([
        [
            "t",
            [
                { name: "tr_InsteadDelete", insteadOf: true, delete: true },
                { name: "tr_AfterInsert", insert: true },
            ],
        ],
        ["salesOrders", [{ name: "tr_Sales", insert: true }]],
        ["plain", []],
        ["checked", []],
        ["unknownCheck", []],
        ["cascade", []],
    ]),
    foreignKeys: new Map([
        ["t", [{ name: "FK_NoAction", updateAction: "noAction", deleteAction: "noAction" }]],
        ["cascade", [{ name: "FK_Cascade", updateAction: "cascade", deleteAction: "cascade" }]],
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
    const snapshot = await runtime.open("file:///trigger-catalog.sql", 1, sql);
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
const body = "AS BEGIN RETURN; END;";

suite("T-SQL trigger schema and ownership validation", () => {
    // A qualified trigger name in a different schema than its target is reported at that schema.
    test("reports a mismatched trigger schema with exact output", async () => {
        assert.deepEqual(
            await analyze(`CREATE TRIGGER sales.tr ON dbo.Orders AFTER INSERT ${body}`),
            [
                {
                    code: "InvalidTriggerSchema",
                    message:
                        "Cannot create trigger 'sales.tr' because its schema is different from the schema of the target table or view.",
                    severity: "error",
                    text: "sales",
                },
            ],
        );
    });

    // An unqualified create takes the target's schema, and a matching qualified one agrees.
    test("accepts every create whose schemas agree", async () => {
        for (const sql of [
            `CREATE TRIGGER tr ON dbo.Orders AFTER INSERT ${body}`,
            `CREATE TRIGGER dbo.tr ON dbo.Orders AFTER INSERT ${body}`,
            // An unqualified name follows the target into another schema on the create path.
            `CREATE TRIGGER tr ON sales.Orders AFTER INSERT ${body}`,
            `CREATE TRIGGER sales.tr ON sales.Orders AFTER INSERT ${body}`,
            `CREATE OR ALTER TRIGGER dbo.tr ON dbo.Orders AFTER INSERT ${body}`,
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // An alter names an existing trigger, which is attached to one specific object.
    test("reports an alter against the wrong object with exact output", async () => {
        assert.deepEqual(
            await analyze(`ALTER TRIGGER tr_Sales ON sales.Orders AFTER INSERT ${body}`),
            [
                {
                    code: "TriggerDoesNotBelongToTarget",
                    message:
                        "Cannot alter trigger 'tr_Sales' on 'sales.Orders' because this trigger does not belong to this object. Specify the correct trigger name or the correct target object name.",
                    severity: "error",
                    text: "tr_Sales",
                },
            ],
        );
        // Qualifying the trigger with its own schema makes the same statement valid.
        assert.deepEqual(
            await analyze(`ALTER TRIGGER sales.tr_Sales ON sales.Orders AFTER INSERT ${body}`),
            [],
        );
        assert.deepEqual(
            await analyze(`ALTER TRIGGER tr_AfterInsert ON dbo.Orders AFTER INSERT ${body}`),
            [],
        );
    });

    // Quoted and multipart names classify identically.
    test("handles quoted names", async () => {
        assert.deepEqual(
            codes(
                await analyze(`CREATE TRIGGER [sales].[tr] ON [dbo].[Orders] AFTER INSERT ${body}`),
            ),
            ["InvalidTriggerSchema"],
        );
        assert.deepEqual(
            await analyze(`CREATE TRIGGER [dbo].[tr] ON [dbo].[Orders] AFTER INSERT ${body}`),
            [],
        );
    });
});

suite("T-SQL trigger target validation", () => {
    // A view accepts only INSTEAD OF triggers.
    test("reports a non-INSTEAD OF trigger on a view with exact output", async () => {
        assert.deepEqual(await analyze(`CREATE TRIGGER tr ON dbo.PlainView AFTER INSERT ${body}`), [
            {
                code: "RequiredInsteadOfTriggerOnView",
                message:
                    "Cannot create trigger 'tr' on 'dbo.PlainView'. Only INSTEAD OF triggers are valid on views.",
                severity: "error",
                text: "tr",
            },
        ]);
        assert.deepEqual(
            codes(await analyze(`CREATE TRIGGER tr ON dbo.PlainView FOR UPDATE ${body}`)),
            ["RequiredInsteadOfTriggerOnView"],
        );
        assert.deepEqual(
            await analyze(`CREATE TRIGGER tr ON dbo.PlainView INSTEAD OF INSERT ${body}`),
            [],
        );
        // A table accepts AFTER and FOR triggers, so the rule is view-only.
        assert.deepEqual(await analyze(`CREATE TRIGGER tr ON dbo.Orders AFTER INSERT ${body}`), []);
    });

    // A view defined WITH CHECK OPTION accepts no trigger at all.
    test("reports a trigger on a CHECK OPTION view with exact output", async () => {
        assert.deepEqual(
            await analyze(`CREATE TRIGGER tr ON dbo.CheckedView INSTEAD OF INSERT ${body}`),
            [
                {
                    code: "CannotCreateTriggerOnViewWithCheckOption",
                    message:
                        "Cannot create trigger 'tr' on 'dbo.CheckedView' because the view is defined with CHECK OPTION.",
                    severity: "error",
                    text: "tr",
                },
            ],
        );
        // A backend that cannot report CHECK OPTION must not become a false positive.
        assert.deepEqual(
            await analyze(`CREATE TRIGGER tr ON dbo.UnknownView INSTEAD OF INSERT ${body}`),
            [],
        );
    });

    // An INSTEAD OF trigger cannot replace an action the table already cascades.
    test("reports a cascading foreign key with exact output", async () => {
        assert.deepEqual(
            await analyze(`CREATE TRIGGER tr ON dbo.Cascading INSTEAD OF UPDATE ${body}`),
            [
                {
                    code: "CannotCreateInsteadOfTriggerOnTableWithCascade",
                    message:
                        "Cannot create INSTEAD OF UPDATE trigger 'tr' on 'dbo.Cascading'. This is because table has a FOREIGN KEY with cascading UPDATE.",
                    severity: "error",
                    text: "tr",
                },
            ],
        );
        assert.deepEqual(
            (
                await analyze(
                    `CREATE TRIGGER tr ON dbo.Cascading INSTEAD OF UPDATE, DELETE ${body}`,
                )
            ).map(({ message }) => message),
            [
                "Cannot create INSTEAD OF UPDATE trigger 'tr' on 'dbo.Cascading'. This is because table has a FOREIGN KEY with cascading UPDATE.",
                "Cannot create INSTEAD OF DELETE trigger 'tr' on 'dbo.Cascading'. This is because table has a FOREIGN KEY with cascading DELETE.",
            ],
        );
        // INSERT never cascades, a non-cascading key is fine, and AFTER triggers are unaffected.
        for (const sql of [
            `CREATE TRIGGER tr ON dbo.Cascading INSTEAD OF INSERT ${body}`,
            `CREATE TRIGGER tr ON dbo.Cascading AFTER UPDATE ${body}`,
            `CREATE TRIGGER tr ON dbo.Orders INSTEAD OF UPDATE ${body}`,
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Only one INSTEAD OF trigger per action may exist on an object.
    test("reports a duplicate INSTEAD OF activation with exact output", async () => {
        assert.deepEqual(
            await analyze(`CREATE TRIGGER tr ON dbo.Orders INSTEAD OF DELETE ${body}`),
            [
                {
                    code: "DuplicateInsteadOfTrigger",
                    message:
                        "Cannot create trigger 'tr' on 'dbo.Orders' because an INSTEAD OF DELETE trigger already exists on this object.",
                    severity: "error",
                    text: "tr",
                },
            ],
        );
        // The existing trigger only claims DELETE, and an AFTER trigger never conflicts.
        for (const sql of [
            `CREATE TRIGGER tr ON dbo.Orders INSTEAD OF INSERT ${body}`,
            `CREATE TRIGGER tr ON dbo.Orders INSTEAD OF UPDATE ${body}`,
            `CREATE TRIGGER tr ON dbo.Orders AFTER DELETE ${body}`,
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
        // Altering the trigger that already owns the action does not conflict with itself.
        assert.deepEqual(
            await analyze(`ALTER TRIGGER tr_InsteadDelete ON dbo.Orders INSTEAD OF DELETE ${body}`),
            [],
        );
    });
});

suite("T-SQL trigger catalog completeness", () => {
    // Nothing that depends on the existing trigger set may come from an unloaded state.
    test("never reports from an unloaded trigger set", async () => {
        const states: readonly UnloadedTriggerState["kind"][] = ["loading", "notLoaded", "failed"];
        for (const state of states) {
            assert.deepEqual(
                await analyze(`CREATE TRIGGER tr ON dbo.Orders INSTEAD OF DELETE ${body}`, {
                    triggerStates: new Map([["t", { kind: state }]]),
                }),
                [],
                state,
            );
            assert.deepEqual(
                await analyze(`CREATE TRIGGER sales.tr ON dbo.Orders AFTER INSERT ${body}`, {
                    triggerStates: new Map([["t", { kind: state }]]),
                }),
                [],
                state,
            );
        }
    });

    // A failed refresh that retained prior triggers is still not authoritative.
    test("never reports from a failed state that kept prior data", async () => {
        assert.deepEqual(
            await analyze(`CREATE TRIGGER tr ON dbo.Orders INSTEAD OF DELETE ${body}`, {
                triggerStates: new Map([
                    [
                        "t",
                        {
                            kind: "failed",
                            previous: [{ name: "tr_InsteadDelete", insteadOf: true, delete: true }],
                        },
                    ],
                ]),
            }),
            [],
        );
    });

    // A cascade result needs a loaded foreign key set of its own.
    test("never reports a cascade from an unloaded constraint set", async () => {
        const states: readonly UnloadedForeignKeyState["kind"][] = [
            "loading",
            "notLoaded",
            "failed",
        ];
        for (const state of states) {
            assert.deepEqual(
                await analyze(`CREATE TRIGGER tr ON dbo.Cascading INSTEAD OF UPDATE ${body}`, {
                    foreignKeyStates: new Map([["cascade", { kind: state }]]),
                }),
                [],
                state,
            );
        }
    });

    // An unresolved target has no trigger set at all, and a local target outranks the catalog.
    test("stays silent for unresolved and locally created targets", async () => {
        assert.deepEqual(
            codes(await analyze(`CREATE TRIGGER tr ON dbo.Missing AFTER INSERT ${body}`)),
            [],
        );
        // A view dropped earlier in this document is gone, whatever the pinned catalog still says.
        assert.deepEqual(
            await analyze(`DROP VIEW dbo.PlainView;
GO
CREATE TRIGGER tr ON dbo.PlainView AFTER INSERT ${body}`),
            [],
        );
    });

    // Damaged input never invents a trigger result.
    test("stays silent on malformed editor input", async () => {
        for (const sql of [
            "CREATE TRIGGER tr ON",
            "CREATE TRIGGER tr ON dbo.PlainView AFTER",
            "ALTER TRIGGER",
        ]) {
            assert.deepEqual(await analyze(sql, { allowSyntaxDiagnostics: true }), [], sql);
        }
    });

    // Unrelated statements against the same catalog stay silent.
    test("does not report unrelated statements", async () => {
        for (const sql of [
            "SELECT Id FROM dbo.PlainView;",
            "DROP TRIGGER tr_AfterInsert;",
            "DISABLE TRIGGER tr_AfterInsert ON dbo.Orders;",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });
});

suite("T-SQL trigger catalog incremental equivalence", () => {
    // Incremental analysis of the same final text and generation must equal a fresh analysis.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const uri = "file:///trigger-incremental.sql";
        const first = `SELECT 1;\nGO\nCREATE TRIGGER tr ON dbo.Orders INSTEAD OF INSERT ${body}\n`;
        const final = `SELECT 1;\nGO\nCREATE TRIGGER tr ON dbo.Orders INSTEAD OF DELETE ${body}\n`;
        const initialSyntax = service.parse(new ImmutableTextSnapshot(uri, 1, first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        assert.deepEqual(initial.diagnostics, []);
        const change = {
            start: first.indexOf("INSTEAD OF INSERT") + "INSTEAD OF ".length,
            end: first.indexOf("INSTEAD OF INSERT") + "INSTEAD OF INSERT".length,
            text: "DELETE",
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
        assert.equal(normalize(fresh).length, 1);
    });
});
