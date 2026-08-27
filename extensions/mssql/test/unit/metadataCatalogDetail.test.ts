/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SV-R1 metadata exact-detail extension (schema-visualizer addendum §5,
 * §17.1): column identity (column_id) + exact type facts + default/
 * identity/computed detail land in the snapshot; FK referential actions
 * arrive via *_desc string mapping (NEVER a numeric cast — the catalog's
 * 0/1 and the legacy OnAction 0/1 are swapped); H5B pair identities ride;
 * identity seed/increment are exact TEXT (values beyond
 * Number.MAX_SAFE_INTEGER survive losslessly); OLD 10/4/3-column fixture
 * shapes still hydrate with detail honestly ABSENT (nothing fabricated);
 * and the cm2 codec round-trips every new fact byte-stably.
 */

import { expect } from "chai";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import {
    DataPlaneMetadataSessionSource,
    fkActionFromDesc,
    MetadataService,
} from "../../src/services/metadata/metadataService";
import {
    canonicalPayloadJson,
    computeContentHash,
    rehydrateSnapshot,
    serializeSnapshot,
    validatePayload,
} from "../../src/services/metadata/cache/metadataCacheCodec";

type Row = (string | number | boolean | null)[];

function resultScript(match: (t: string) => boolean, columns: string[], rows: Row[]): FakeScript {
    return {
        match,
        events: [
            { type: "resultSet", columns, rows },
            { type: "complete", status: "succeeded" },
        ],
    };
}

/**
 * Full H0–H7+digest transcript in the SV-R1 EXTENDED shapes. Matcher order
 * is load-bearing (H4/H5B before H3 — "sys.columns" collision; digest
 * before H2 — "FROM sys.objects o WHERE" collision).
 */
function detailScripts(): FakeScript[] {
    return [
        resultScript(
            (t) => t.includes("SERVERPROPERTY"),
            ["engine_edition", "default_schema", "collation_name"],
            [[3, "dbo", "SQL_Latin1_General_CP1_CI_AS"]],
        ),
        resultScript(
            (t) => t.includes("is_primary_key"),
            ["object_id", "name", "index_name", "is_primary_key", "is_unique_constraint"],
            [[201, "OrderId", "PK_Orders", true, false]],
        ),
        resultScript(
            (t) => t.includes("foreign_key_columns"),
            [
                "constraint_object_id",
                "parent_column",
                "referenced_column",
                "constraint_column_id",
                "parent_column_id",
                "referenced_column_id",
            ],
            [
                // Composite FK 901: two ordered pairs with column ids.
                [901, "OrderId", "CustomerCode", 1, 1, 1],
                [901, "Total", "CustomerCode", 2, 2, 1],
                [902, "Notes", "CustomerCode", 1, 3, 1],
                [903, "Tax", "CustomerCode", 1, 4, 1],
                [904, "OrderId", "CustomerCode", 1, 1, 1],
            ],
        ),
        resultScript(
            (t) => t.includes("CHECKSUM_AGG"),
            ["current_db", "object_count", "object_hash"],
            [["DbDetail", 2, 777]],
        ),
        resultScript(
            (t) => t.includes("sys.parameters"),
            [
                "object_id",
                "parameter_id",
                "name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_output",
            ],
            [],
        ),
        resultScript(
            (t) => t.includes("extended_properties"),
            ["major_id", "minor_id", "column_name", "description"],
            [],
        ),
        resultScript(
            (t) => t.includes("sys.schemas"),
            ["schema_id", "name"],
            [
                [1, "dbo"],
                [2, "app"],
            ],
        ),
        resultScript(
            (t) => t.includes("FROM sys.objects o WHERE"),
            ["object_id", "schema_id", "name", "type", "modify_date"],
            [
                [201, 1, "Orders", "U", "2026-01-01T00:00:00"],
                [202, 1, "Customers", "U", "2026-01-01T00:00:00"],
            ],
        ),
        resultScript(
            (t) => t.includes("sys.columns"),
            [
                "object_id",
                "column_id",
                "name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_nullable",
                "is_identity",
                "is_computed",
                "system_type_id",
                "user_type_id",
                "type_schema",
                "base_type_name",
                "is_user_defined",
                "is_assembly_type",
                "collation_name",
                "default_name",
                "default_definition",
                "identity_seed",
                "identity_increment",
                "computed_definition",
                "computed_persisted",
            ],
            [
                // bigint identity with a seed BEYOND Number.MAX_SAFE_INTEGER —
                // exact-text losslessness is the point (§5.3).
                // prettier-ignore
                [201, 1, "OrderId", "bigint", 8, 19, 0, false, true, false,
                    127, 127, "sys", "bigint", false, false, null,
                    null, null, "9223372036854775806", "1", null, null],
                // decimal(38,2) + named default.
                // prettier-ignore
                [201, 2, "Total", "decimal", 17, 38, 2, true, false, false,
                    106, 106, "sys", "decimal", false, false, null,
                    "DF_Orders_Total", "((0))", null, null, null, null],
                // nvarchar(max): raw max_length stays -1 (bytes semantics).
                // prettier-ignore
                [201, 3, "Notes", "nvarchar", -1, 0, 0, true, false, false,
                    231, 231, "sys", "nvarchar", false, false,
                    "Latin1_General_100_CI_AS_SC",
                    null, null, null, null, null, null],
                // persisted computed column.
                // prettier-ignore
                [201, 4, "Tax", "money", 8, 19, 4, true, false, true,
                    60, 60, "sys", "money", false, false, null,
                    null, null, null, null, "([Total]*(0.1))", true],
                // alias UDT: user type app.CustomerCodeType over nvarchar.
                // prettier-ignore
                [202, 1, "CustomerCode", "CustomerCodeType", 16, 0, 0, false, false, false,
                    231, 257, "app", "nvarchar", true, false,
                    "SQL_Latin1_General_CP1_CI_AS",
                    null, null, null, null, null, null],
            ],
        ),
        resultScript(
            (t) => t.includes("sys.foreign_keys"),
            [
                "object_id",
                "name",
                "parent_object_id",
                "referenced_object_id",
                "delete_referential_action_desc",
                "update_referential_action_desc",
            ],
            [
                [901, "FK_Cascade", 201, 202, "CASCADE", "NO_ACTION"],
                [902, "FK_SetNull", 201, 202, "SET_NULL", "SET_DEFAULT"],
                // NULL descs (e.g. permission-shaped weirdness): must land
                // UNKNOWN → absent on the read surface, never NO_ACTION.
                [903, "FK_Unknown", 201, 202, null, null],
                [904, "FK_NoAction", 201, 202, "NO_ACTION", "NO_ACTION"],
            ],
        ),
    ];
}

/** OLD pre-SV-R1 shapes: 10-column H3, 4-column H5, 3-column H5B. */
function oldShapeScripts(): FakeScript[] {
    return [
        resultScript(
            (t) => t.includes("SERVERPROPERTY"),
            ["engine_edition", "default_schema", "collation_name"],
            [[3, "dbo", "SQL_Latin1_General_CP1_CI_AS"]],
        ),
        resultScript(
            (t) => t.includes("is_primary_key"),
            ["object_id", "name", "index_name", "is_primary_key", "is_unique_constraint"],
            [],
        ),
        resultScript(
            (t) => t.includes("foreign_key_columns"),
            ["constraint_object_id", "parent_column", "referenced_column"],
            [[901, "A", "B"]],
        ),
        resultScript(
            (t) => t.includes("CHECKSUM_AGG"),
            ["current_db", "object_count", "object_hash"],
            [["DbOld", 2, 1]],
        ),
        resultScript((t) => t.includes("sys.parameters"), ["object_id"], []),
        resultScript((t) => t.includes("extended_properties"), ["major_id"], []),
        resultScript((t) => t.includes("sys.schemas"), ["schema_id", "name"], [[1, "dbo"]]),
        resultScript(
            (t) => t.includes("FROM sys.objects o WHERE"),
            ["object_id", "schema_id", "name", "type", "modify_date"],
            [
                [301, 1, "T1", "U", "2026-01-01T00:00:00"],
                [302, 1, "T2", "U", "2026-01-01T00:00:00"],
            ],
        ),
        resultScript(
            (t) => t.includes("sys.columns"),
            [
                "object_id",
                "column_id",
                "name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_nullable",
                "is_identity",
                "is_computed",
            ],
            [[301, 1, "A", "int", 4, 10, 0, false, true, false]],
        ),
        resultScript(
            (t) => t.includes("sys.foreign_keys"),
            ["object_id", "name", "parent_object_id", "referenced_object_id"],
            [[901, "FK_Old", 301, 302]],
        ),
    ];
}

async function hydrated(scripts: FakeScript[], database: string) {
    const backend = new FakeBackend({ scripts });
    const source = new DataPlaneMetadataSessionSource(backend, {
        profile: { profileFingerprint: "fp", server: "srv", authKind: "sql", user: "u" },
        applicationName: "test",
    });
    const service = new MetadataService(source, { pollSeconds: 0 });
    const handle = service.acquire({ serverFingerprint: "sha256:test", database });
    await handle.refresh();
    return { service, handle, snapshot: handle.current()! };
}

suite("Metadata exact detail (SV-R1, visualizer addendum §5)", () => {
    test("fkActionFromDesc maps desc STRINGS only — numerics are UNKNOWN, never cast", () => {
        expect(fkActionFromDesc("NO_ACTION")).to.equal("NO_ACTION");
        expect(fkActionFromDesc("CASCADE")).to.equal("CASCADE");
        expect(fkActionFromDesc("SET_NULL")).to.equal("SET_NULL");
        expect(fkActionFromDesc("SET_DEFAULT")).to.equal("SET_DEFAULT");
        // The addendum's exact hazard: catalog 0=NO_ACTION/1=CASCADE vs
        // OnAction 0=CASCADE/1=NO_ACTION. Numbers must NEVER map.
        expect(fkActionFromDesc(0)).to.equal("UNKNOWN");
        expect(fkActionFromDesc(1)).to.equal("UNKNOWN");
        expect(fkActionFromDesc(null)).to.equal("UNKNOWN");
        expect(fkActionFromDesc(undefined)).to.equal("UNKNOWN");
        expect(fkActionFromDesc("CASCADE ")).to.equal("UNKNOWN");
    });

    test("extended H3: exact type facts, defaults, identity TEXT, computed, alias UDT", async () => {
        const { service, snapshot } = await hydrated(detailScripts(), "DbDetail");
        const columns = snapshot.getColumns(201);
        expect(columns.map((c) => c.columnId)).to.deep.equal([1, 2, 3, 4]);

        const orderId = columns[0];
        expect(orderId.detail).to.not.equal(undefined);
        expect(orderId.detail!.typeName).to.equal("bigint");
        expect(orderId.detail!.systemTypeId).to.equal(127);
        expect(orderId.detail!.precision).to.equal(19);
        // Exact TEXT beyond Number.MAX_SAFE_INTEGER — a number round-trip
        // would corrupt this value (…806 → …808).
        expect(orderId.detail!.identity).to.deep.equal({
            seedText: "9223372036854775806",
            incrementText: "1",
        });
        // Proof the text path matters: JS number parsing corrupts this value.
        expect(String(Number("9223372036854775806"))).to.not.equal("9223372036854775806");

        const total = columns[1];
        expect(total.detail!.precision).to.equal(38);
        expect(total.detail!.scale).to.equal(2);
        expect(total.detail!.default).to.deep.equal({
            name: "DF_Orders_Total",
            definition: "((0))",
        });
        expect(total.detail!.identity).to.equal(undefined);

        const notes = columns[2];
        expect(notes.detail!.maxLengthBytes).to.equal(-1); // raw bytes: max
        expect(notes.detail!.collationName).to.equal("Latin1_General_100_CI_AS_SC");

        const tax = columns[3];
        expect(tax.isComputed).to.equal(true);
        expect(tax.detail!.computed).to.deep.equal({
            definition: "([Total]*(0.1))",
            persisted: true,
        });

        const udt = snapshot.getColumns(202)[0];
        expect(udt.detail!.typeName).to.equal("CustomerCodeType");
        expect(udt.detail!.typeSchema).to.equal("app");
        expect(udt.detail!.baseTypeName).to.equal("nvarchar");
        expect(udt.detail!.isUserDefined).to.equal(true);
        expect(udt.detail!.userTypeId).to.equal(257);
        expect(udt.detail!.systemTypeId).to.equal(231);
        service.dispose();
    });

    test("extended H5/H5B: actions land by name; UNKNOWN stays ABSENT; pair identities ride", async () => {
        const { service, snapshot } = await hydrated(detailScripts(), "DbDetail");
        const edges = snapshot.getForeignKeysFrom(201);
        const byName = new Map(edges.map((e) => [e.name, e]));
        expect(byName.get("FK_Cascade")!.onDelete).to.equal("CASCADE");
        expect(byName.get("FK_Cascade")!.onUpdate).to.equal("NO_ACTION");
        expect(byName.get("FK_SetNull")!.onDelete).to.equal("SET_NULL");
        expect(byName.get("FK_SetNull")!.onUpdate).to.equal("SET_DEFAULT");
        expect(byName.get("FK_NoAction")!.onDelete).to.equal("NO_ACTION");
        // UNKNOWN: the property is ABSENT — a UI reading it must show
        // "Unknown", and a deep-equal consumer never sees "NO_ACTION".
        expect(byName.get("FK_Unknown")).to.not.have.property("onDelete");
        expect(byName.get("FK_Unknown")).to.not.have.property("onUpdate");
        expect(byName.get("FK_Cascade")!.constraintObjectId).to.equal(901);

        const details = snapshot.getForeignKeyDetailsFrom(201);
        const composite = details.find((d) => d.name === "FK_Cascade")!;
        expect(composite.columns).to.deep.equal([
            {
                fromColumn: "OrderId",
                toColumn: "CustomerCode",
                ordinal: 1,
                fromColumnId: 1,
                toColumnId: 1,
            },
            {
                fromColumn: "Total",
                toColumn: "CustomerCode",
                ordinal: 2,
                fromColumnId: 2,
                toColumnId: 1,
            },
        ]);
        service.dispose();
    });

    test("OLD fixture shapes hydrate with detail honestly ABSENT — nothing fabricated", async () => {
        const { service, snapshot } = await hydrated(oldShapeScripts(), "DbOld");
        const column = snapshot.getColumns(301)[0];
        // column_id was ALWAYS selected — retained even from old shapes.
        expect(column.columnId).to.equal(1);
        expect(column.isIdentity).to.equal(true);
        expect(column).to.not.have.property("detail");

        const edge = snapshot.getForeignKeysFrom(301)[0];
        expect(edge.constraintObjectId).to.equal(901);
        expect(edge).to.not.have.property("onDelete");
        expect(edge).to.not.have.property("onUpdate");

        const pair = snapshot.getForeignKeyDetailsFrom(301)[0].columns[0];
        expect(pair).to.deep.equal({ fromColumn: "A", toColumn: "B" });
        service.dispose();
    });

    test("cm2 codec round-trips every new fact byte-stably", async () => {
        const { service, snapshot } = await hydrated(detailScripts(), "DbDetail");
        const payload = serializeSnapshot(snapshot);
        const validated = validatePayload(JSON.parse(canonicalPayloadJson(payload)), {
            descriptionsExpected: false,
        });
        expect(validated.ok, JSON.stringify(validated)).to.equal(true);
        const rehydrated = rehydrateSnapshot(payload, {
            generation: snapshot.generation,
            readiness: snapshot.readiness,
            mode: snapshot.mode,
        });
        expect(rehydrated.getColumns(201)).to.deep.equal(snapshot.getColumns(201));
        expect(rehydrated.getColumns(202)).to.deep.equal(snapshot.getColumns(202));
        expect(rehydrated.getForeignKeysFrom(201)).to.deep.equal(snapshot.getForeignKeysFrom(201));
        expect(rehydrated.getForeignKeyDetailsFrom(201)).to.deep.equal(
            snapshot.getForeignKeyDetailsFrom(201),
        );
        // serialize(rehydrate(serialize(x))) is byte-identical.
        expect(canonicalPayloadJson(serializeSnapshot(rehydrated))).to.equal(
            canonicalPayloadJson(payload),
        );
        expect(computeContentHash(serializeSnapshot(rehydrated))).to.equal(
            computeContentHash(payload),
        );
        service.dispose();
    });

    test("unchanged re-hydration: generation moves, content hash does NOT (fingerprint substrate)", async () => {
        // Two hydrations over the SAME transcript: generation N vs N+1 must
        // produce identical canonical content — the invariant the SV-R2
        // visualizer fingerprint (generation-independent) builds on.
        const first = await hydrated(detailScripts(), "DbDetail");
        const firstHash = computeContentHash(serializeSnapshot(first.snapshot));
        const firstGeneration = first.snapshot.generation;
        await first.handle.refresh();
        const second = first.handle.current()!;
        expect(second.generation).to.be.greaterThan(firstGeneration);
        expect(computeContentHash(serializeSnapshot(second))).to.equal(firstHash);
        first.service.dispose();
    });
});
