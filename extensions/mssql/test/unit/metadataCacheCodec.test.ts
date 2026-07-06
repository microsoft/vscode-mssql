/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CACHE-1 snapshot codec (cache/drift design §7.3, review addendum §6):
 * - Round-trip proof (§6.5) on a case-insensitive AND a BIN2 case-sensitive
 *   fixture: (a) buildSchemaContext bytes identical, (b) folded-index
 *   search results identical, (c) contentHash identical, (d) readiness/
 *   mode/generation/environment identical.
 * - T-A7: contentHash equality live-built vs rehydrated; inequality on ANY
 *   canonical array perturbation (every field in the frozen tuple).
 * - Strictness (§6.4): unknown top-level fields, non-finite numbers,
 *   description sections present only when the flag says so, parallel
 *   length and sym/owner range violations — all clean "shape" rejects.
 * - Privacy: descriptions excluded by default; excluded prose is BLANKED
 *   out of the string table, not just unreferenced.
 * - Manifest validation: formatVersion/codec/modelVersion mismatches map
 *   to their own miss reasons (clean miss, never a migration).
 * - CatalogSnapshot.contentHash is set-once (different value throws).
 */

import { expect } from "chai";
import {
    buildSchemaContext,
    CatalogBuilder,
    CatalogSnapshot,
    SchemaContextRequest,
} from "../../src/services/metadata/catalogModel";
import {
    adoptPayload,
    CANONICAL_PAYLOAD_FIELDS,
    canonicalPayloadJson,
    CATALOG_MODEL_VERSION,
    CatalogCachePayloadV1,
    computeContentHash,
    rehydrateSnapshot,
    serializeSnapshot,
    stripDescriptions,
    validatePayload,
} from "../../src/services/metadata/cache/metadataCacheCodec";
import {
    CatalogCacheManifest,
    validateManifest,
} from "../../src/services/metadata/cache/metadataCacheManifest";

// ---------------------------------------------------------------------------
// Fixtures — "live-built" snapshots exercising every SoA array family
// ---------------------------------------------------------------------------

const CANARY_DESCRIPTION = "Order header rows. Contact srv-secret-host as user=KarlB.";
const CANARY_TOKENISH = "References the customer. token=eyJhbGciOiJIUzI1NiJ9.canary";

function buildFixture(options?: { caseSensitive?: boolean; generation?: number }): CatalogSnapshot {
    const b = new CatalogBuilder();
    const caseSensitive = options?.caseSensitive ?? false;
    b.setEnvironment({
        engineEdition: 5,
        defaultSchema: "dbo",
        collationName: caseSensitive ? "Latin1_General_BIN2" : "SQL_Latin1_General_CP1_CI_AS",
        caseSensitive,
    });
    b.addSchema(1, "dbo");
    b.addSchema(5, "Sales");
    b.addObject(101, 1, "Orders", "table", "2026-01-05T10:00:00");
    b.addObject(102, 5, "Order_Details", "table", "2026-01-05T10:00:01");
    b.addObject(103, 1, "Customers", "table"); // no modify date → null cell
    b.addObject(110, 1, "vOrders", "view", "2026-01-06T08:00:00");
    b.addObject(120, 1, "GetOrders", "procedure", "2026-01-06T09:00:00");
    b.addObject(121, 1, "fnTotal", "scalarFunction", "2026-01-06T09:30:00");
    b.addObject(130, 1, "OrdersSyn", "synonym", "2026-01-06T09:45:00");
    if (caseSensitive) {
        // Case-only sibling: BIN2 resolveName must reject folded-only hits.
        b.addObject(104, 1, "orders", "table", "2026-01-05T11:00:00");
        b.addColumn(104, "id", "int", false);
    }
    b.addColumn(101, "OrderId", "int", false, true, false);
    b.addColumn(101, "CustomerId", "int", true);
    b.addColumn(101, "Total", "decimal(10,2)", true, false, true);
    b.addColumn(102, "Id", "int", false, true);
    b.addColumn(102, "OrderId", "int", false);
    b.addColumn(103, "CustomerId", "int", false, true);
    b.addColumn(103, "Name", "nvarchar(50)", false);
    b.addColumn(110, "OrderId", "int", false);
    b.markPrimaryKeyColumn(101, "OrderId");
    b.markPrimaryKeyColumn(103, "CustomerId");
    b.addKeyConstraintColumn(101, "PK_Orders", "primaryKey", "OrderId");
    b.addKeyConstraintColumn(103, "PK_Customers", "primaryKey", "CustomerId");
    b.addKeyConstraintColumn(103, "UQ_Customers_Name", "uniqueConstraint", "Name");
    b.addKeyConstraintColumn(103, "UQ_Customers_Name", "uniqueConstraint", "CustomerId");
    b.addForeignKey(102, 101, "FK_OrderDetails_Orders", 9001);
    b.addForeignKey(101, 103, "FK_Orders_Customers", 9002);
    b.addForeignKeyColumn(9001, "OrderId", "OrderId");
    b.addForeignKeyColumn(9002, "CustomerId", "CustomerId");
    b.addParameter(120, 1, "@from", "datetime2(7)", false);
    b.addParameter(120, 2, "@count", "int", true);
    b.addParameter(121, 0, "", "int", false);
    // Live-hydrated catalogs carry descriptions; the CODEC decides whether
    // they reach disk. Values double as the privacy canaries.
    b.addDescription(101, CANARY_DESCRIPTION);
    b.addDescription(101, CANARY_TOKENISH, "CustomerId");
    b.addDescription(110, "Read view over orders.");
    return b.build(
        options?.generation ?? 7,
        {
            schemas: "ready",
            objects: "ready",
            synonyms: "ready",
            types: "ready",
            columns: "ready",
            keys: "ready",
            foreignKeys: "ready",
            parameters: "ready",
            descriptions: "ready",
        },
        "full",
    );
}

const UNLIMITED_REQUEST: SchemaContextRequest = {
    budget: "unlimited",
    privacy: { destination: "local", allowObjectNames: true },
};

function roundTrip(
    live: CatalogSnapshot,
    options?: { includeDescriptions?: boolean },
): { payload: CatalogCachePayloadV1; rehydrated: CatalogSnapshot } {
    const payload = serializeSnapshot(live, options);
    const validated = validatePayload(JSON.parse(canonicalPayloadJson(payload)), {
        descriptionsExpected: options?.includeDescriptions === true,
    });
    expect(validated.ok, "serialized payload must validate").to.equal(true);
    const rehydrated = rehydrateSnapshot(payload, {
        generation: live.generation,
        readiness: live.readiness,
        mode: live.mode,
    });
    return { payload, rehydrated };
}

// ---------------------------------------------------------------------------

suite("Metadata cache codec (CACHE-1): round-trip proof (§6.5)", () => {
    for (const caseSensitive of [false, true]) {
        const label = caseSensitive ? "BIN2 case-sensitive" : "case-insensitive";
        test(`${label} fixture: schema-context bytes, search, contentHash, metadata all identical`, () => {
            const live = buildFixture({ caseSensitive });
            const { payload, rehydrated } = roundTrip(live, { includeDescriptions: true });

            // (a) buildSchemaContext bytes identical — the byte-identity
            // gate the whole cache effort hangs on.
            const liveContext = buildSchemaContext(live, UNLIMITED_REQUEST);
            const cachedContext = buildSchemaContext(rehydrated, UNLIMITED_REQUEST);
            expect(liveContext.text.length).to.be.greaterThan(0);
            expect(cachedContext).to.deep.equal(liveContext);
            const focused: SchemaContextRequest = {
                budget: "balanced",
                focus: { nameHints: ["Orders"] },
                include: { fkOneHop: true },
                privacy: { destination: "local", allowObjectNames: true },
            };
            expect(buildSchemaContext(rehydrated, focused)).to.deep.equal(
                buildSchemaContext(live, focused),
            );

            // (b) folded-index search results identical.
            for (const prefix of ["ord", "o", "customers", "vo", "fn", ""]) {
                expect(rehydrated.search(prefix)).to.deep.equal(live.search(prefix));
            }
            for (const parts of [
                ["Orders"],
                ["orders"],
                ["dbo", "Orders"],
                ["Sales", "Order_Details"],
            ]) {
                expect(rehydrated.resolveName(parts)).to.deep.equal(live.resolveName(parts));
            }
            if (caseSensitive) {
                // BIN2 (§6.3): an exact raw match resolves; a folded-only
                // lookup over the Orders/orders pair is AMBIGUOUS (reported,
                // never guessed) — identically before and after rehydration.
                expect(rehydrated.resolveName(["orders"]).kind).to.equal("resolved");
                expect(rehydrated.resolveName(["ORDERS"]).kind).to.equal("ambiguous");
            }

            // (c) contentHash identical: live-built vs rehydrated (T-A7).
            const liveHash = computeContentHash(payload);
            expect(rehydrated.contentHash).to.equal(liveHash);
            expect(
                computeContentHash(serializeSnapshot(rehydrated, { includeDescriptions: true })),
            ).to.equal(liveHash);

            // (d) readiness/mode/generation/environment identical.
            expect(rehydrated.generation).to.equal(live.generation);
            expect(rehydrated.mode).to.equal(live.mode);
            expect(rehydrated.readiness).to.deep.equal(live.readiness);
            expect(rehydrated.engineEdition).to.equal(live.engineEdition);
            expect(rehydrated.defaultSchema).to.equal(live.defaultSchema);
            expect(rehydrated.caseSensitive).to.equal(live.caseSensitive);
            expect(rehydrated.codecView.environment).to.deep.equal(live.codecView.environment);

            // Full read-surface parity for the data families.
            expect(rehydrated.listSchemas()).to.deep.equal(live.listSchemas());
            expect(rehydrated.listObjects()).to.deep.equal(live.listObjects());
            for (const id of [101, 102, 103, 110, 120, 121]) {
                expect(rehydrated.getColumns(id)).to.deep.equal(live.getColumns(id));
                expect(rehydrated.getPrimaryKeyColumns(id)).to.deep.equal(
                    live.getPrimaryKeyColumns(id),
                );
                expect(rehydrated.getKeyConstraints(id)).to.deep.equal(live.getKeyConstraints(id));
                expect(rehydrated.getForeignKeyDetailsFrom(id)).to.deep.equal(
                    live.getForeignKeyDetailsFrom(id),
                );
                expect(rehydrated.getForeignKeyDetailsTo(id)).to.deep.equal(
                    live.getForeignKeyDetailsTo(id),
                );
                expect(rehydrated.getParameters(id)).to.deep.equal(live.getParameters(id));
                expect(rehydrated.getDescription(id)).to.equal(live.getDescription(id));
            }
            expect(rehydrated.getDescription(101, "CustomerId")).to.equal(
                live.getDescription(101, "CustomerId"),
            );
            expect(rehydrated.stats).to.deep.equal(live.stats);
        });
    }

    test("serialize→rehydrate→serialize is byte-stable (canonical JSON identical)", () => {
        const live = buildFixture();
        for (const includeDescriptions of [false, true]) {
            const first = serializeSnapshot(live, { includeDescriptions });
            const again = serializeSnapshot(
                rehydrateSnapshot(first, {
                    generation: live.generation,
                    readiness: live.readiness,
                    mode: live.mode,
                }),
                { includeDescriptions },
            );
            expect(canonicalPayloadJson(again)).to.equal(canonicalPayloadJson(first));
        }
    });
});

suite("Metadata cache codec (CACHE-1): contentHash (T-A7)", () => {
    test("perturbing ANY canonical field changes the hash", () => {
        const payload = serializeSnapshot(buildFixture(), { includeDescriptions: true });
        const baseline = computeContentHash(payload);
        for (const field of CANONICAL_PAYLOAD_FIELDS) {
            const clone = structuredClone(payload) as unknown as Record<string, unknown>;
            if (field === "environment") {
                const environment = clone["environment"] as { caseSensitive?: boolean };
                environment.caseSensitive = !(environment.caseSensitive ?? false);
            } else {
                const array = clone[field] as unknown[];
                expect(
                    array.length,
                    `fixture must populate ${field} for the perturbation proof`,
                ).to.be.greaterThan(0);
                const value = array[0];
                if (typeof value === "number") {
                    array[0] = value + 1;
                } else if (typeof value === "boolean") {
                    array[0] = !value;
                } else if (field === "objectKinds") {
                    array[0] = value === "table" ? "view" : "table";
                } else if (field === "keyConstraintKinds") {
                    array[0] = value === "primaryKey" ? "uniqueConstraint" : "primaryKey";
                } else {
                    array[0] = String(value) + "!";
                }
            }
            expect(
                computeContentHash(clone as unknown as CatalogCachePayloadV1),
                `hash must move when ${field} changes`,
            ).to.not.equal(baseline);
        }
    });

    test("hash shape is csh_<22 b64url chars>; canonical JSON key order is the frozen tuple", () => {
        const payload = serializeSnapshot(buildFixture(), { includeDescriptions: true });
        expect(computeContentHash(payload)).to.match(/^csh_[A-Za-z0-9_-]{22}$/);
        expect(CATALOG_MODEL_VERSION).to.equal("cm1");
        const keys = Object.keys(JSON.parse(canonicalPayloadJson(payload)));
        expect(keys).to.deep.equal([...CANONICAL_PAYLOAD_FIELDS]);
        // Default policy: the three description fields are absent, the rest
        // keep the frozen order.
        const withoutDescriptions = Object.keys(
            JSON.parse(canonicalPayloadJson(serializeSnapshot(buildFixture()))),
        );
        expect(withoutDescriptions).to.deep.equal(
            CANONICAL_PAYLOAD_FIELDS.filter((field) => !field.startsWith("description")),
        );
    });

    test("CatalogSnapshot.contentHash is set-once: same value idempotent, different value throws", () => {
        const snapshot = buildFixture();
        expect(snapshot.contentHash).to.equal(undefined);
        snapshot.setContentHashOnce("csh_aaaaaaaaaaaaaaaaaaaaaa");
        snapshot.setContentHashOnce("csh_aaaaaaaaaaaaaaaaaaaaaa"); // no-op
        expect(snapshot.contentHash).to.equal("csh_aaaaaaaaaaaaaaaaaaaaaa");
        expect(() => snapshot.setContentHashOnce("csh_bbbbbbbbbbbbbbbbbbbbbb")).to.throw(
            /set-once/,
        );
    });
});

suite("Metadata cache codec (CACHE-1): privacy — descriptions excluded by default", () => {
    test("default policy: no description arrays, prose BLANKED from the string table", () => {
        const live = buildFixture();
        const payload = serializeSnapshot(live);
        expect(payload.descriptionOwner).to.equal(undefined);
        expect(payload.descriptionColumnSyms).to.equal(undefined);
        expect(payload.descriptionValueSyms).to.equal(undefined);
        const json = canonicalPayloadJson(payload);
        expect(json).to.not.include("srv-secret-host");
        expect(json).to.not.include("KarlB");
        expect(json).to.not.include("eyJhbGciOiJIUzI1NiJ9");
        expect(json).to.not.include("Order header rows");
        expect(json).to.not.include("Read view over orders");
        // Structural strings survive untouched.
        expect(payload.strings).to.include("Orders");
        expect(payload.strings).to.include("CustomerId");
        const rehydrated = rehydrateSnapshot(payload, {
            generation: live.generation,
            readiness: live.readiness,
            mode: live.mode,
        });
        expect(rehydrated.getDescription(101)).to.equal(undefined);
        expect(rehydrated.getDescription(101, "CustomerId")).to.equal(undefined);
        // …and the structural projection is untouched by the exclusion.
        expect(buildSchemaContext(rehydrated, UNLIMITED_REQUEST)).to.deep.equal(
            buildSchemaContext(live, UNLIMITED_REQUEST),
        );
    });

    test("stripDescriptions is idempotent and hash-stable", () => {
        const withDescriptions = serializeSnapshot(buildFixture(), { includeDescriptions: true });
        const stripped = stripDescriptions(withDescriptions);
        expect(canonicalPayloadJson(stripDescriptions(stripped))).to.equal(
            canonicalPayloadJson(stripped),
        );
        // Same bytes as serializing under the default policy directly.
        expect(canonicalPayloadJson(stripped)).to.equal(
            canonicalPayloadJson(serializeSnapshot(buildFixture())),
        );
        expect(computeContentHash(stripped)).to.not.equal(computeContentHash(withDescriptions));
    });
});

suite("Metadata cache codec (CACHE-1): strict validation (§6.4)", () => {
    function payloadWithDescriptions(): CatalogCachePayloadV1 {
        return serializeSnapshot(buildFixture(), { includeDescriptions: true });
    }

    function mutated(mutate: (clone: Record<string, unknown>) => void): unknown {
        const clone = structuredClone(payloadWithDescriptions()) as unknown as Record<
            string,
            unknown
        >;
        mutate(clone);
        return clone;
    }

    test("valid payloads validate in both description modes", () => {
        expect(
            validatePayload(payloadWithDescriptions(), { descriptionsExpected: true }).ok,
        ).to.equal(true);
        expect(
            validatePayload(serializeSnapshot(buildFixture()), {
                descriptionsExpected: false,
            }).ok,
        ).to.equal(true);
    });

    test("unknown top-level field ⇒ reject (shape)", () => {
        const result = validatePayload(
            mutated((clone) => {
                clone["moduleDefinitions"] = [];
            }),
            { descriptionsExpected: true },
        );
        expect(result.ok).to.equal(false);
    });

    test("non-finite / non-integer numbers ⇒ reject", () => {
        for (const bad of [null, Number.NaN, Number.POSITIVE_INFINITY, 1.5, "7"]) {
            const result = validatePayload(
                mutated((clone) => {
                    (clone["schemaIds"] as unknown[])[0] = bad;
                }),
                { descriptionsExpected: true },
            );
            expect(result.ok, `schemaIds[0]=${String(bad)} must reject`).to.equal(false);
        }
    });

    test("description sections present only when the flag says so (both directions)", () => {
        expect(
            validatePayload(payloadWithDescriptions(), { descriptionsExpected: false }).ok,
        ).to.equal(false);
        expect(
            validatePayload(serializeSnapshot(buildFixture()), {
                descriptionsExpected: true,
            }).ok,
        ).to.equal(false);
    });

    test("parallel length mismatch ⇒ reject", () => {
        const result = validatePayload(
            mutated((clone) => {
                (clone["columnNameSyms"] as unknown[]).pop();
            }),
            { descriptionsExpected: true },
        );
        expect(result.ok).to.equal(false);
    });

    test("out-of-range sym / owner indexes ⇒ reject", () => {
        const badSym = validatePayload(
            mutated((clone) => {
                (clone["objectNameSyms"] as number[])[0] = 10_000;
            }),
            { descriptionsExpected: true },
        );
        expect(badSym.ok).to.equal(false);
        const badOwner = validatePayload(
            mutated((clone) => {
                (clone["columnOwner"] as number[])[0] = -1;
            }),
            { descriptionsExpected: true },
        );
        expect(badOwner.ok).to.equal(false);
    });

    test("unknown environment field / wrong environment types ⇒ reject", () => {
        expect(
            validatePayload(
                mutated((clone) => {
                    (clone["environment"] as Record<string, unknown>)["serverName"] = "leaky";
                }),
                { descriptionsExpected: true },
            ).ok,
        ).to.equal(false);
        expect(
            validatePayload(
                mutated((clone) => {
                    (clone["environment"] as Record<string, unknown>)["caseSensitive"] = "yes";
                }),
                { descriptionsExpected: true },
            ).ok,
        ).to.equal(false);
    });

    test("adoptPayload preserves symbol identity (direct adoption, no re-intern)", () => {
        const payload = payloadWithDescriptions();
        const builder = adoptPayload(payload);
        expect(builder.stringTable).to.deep.equal(payload.strings);
        expect(builder.objectNameSyms).to.deep.equal(payload.objectNameSyms);
        // intern() of an existing string returns its ORIGINAL symbol id.
        const existingSym = payload.objectNameSyms[0];
        expect(builder.intern(payload.strings[existingSym])).to.equal(existingSym);
    });
});

suite("Metadata cache codec (CACHE-1): manifest validation", () => {
    function validManifest(): CatalogCacheManifest {
        return {
            formatVersion: 1,
            producer: {
                extensionVersion: "1.34.0",
                appVersion: "1.102.0",
                catalogModelVersion: CATALOG_MODEL_VERSION,
                cacheCodec: "json-gzip-v1",
            },
            writerId: "1234:abc",
            key: {
                serverFingerprint: "sfp_0123456789abcdefghijkl",
                databaseHash: "dbh_0123456789abcdefghijkl",
                databaseExact: "Db1",
            },
            capture: {
                capturedAtUtc: "2026-07-06T12:00:00.000Z",
                publishedGeneration: 7,
                source: "live",
            },
            validation: { lastValidatedAtUtc: "2026-07-06T12:00:01.000Z" },
            environment: { engineEdition: 5, caseSensitive: false, defaultSchema: "dbo" },
            readiness: {
                schemas: "ready",
                objects: "ready",
                synonyms: "ready",
                columns: "ready",
                types: "ready",
                keys: "ready",
                foreignKeys: "ready",
                indexes: "absent",
                constraints: "absent",
                parameters: "ready",
                descriptions: "absent",
                rowCounts: "absent",
            },
            mode: "full",
            stats: { schemas: 2, objects: 7, columns: 8, foreignKeys: 2, payloadBytes: 1234 },
            privacy: {
                includesDescriptions: false,
                includesModuleDefinitions: false,
                includesRowCounts: false,
                policyId: "cp1:d0m0",
            },
            payload: {
                file: "catalog.json.gz",
                sha256: "deadbeef",
                contentHash: "csh_0123456789abcdefghijkl",
            },
        };
    }

    test("a well-formed manifest validates", () => {
        expect(validateManifest(validManifest()).ok).to.equal(true);
    });

    test("formatVersion / codec / modelVersion mismatches map to their own clean-miss reasons", () => {
        const cases: ReadonlyArray<readonly [string, (m: Record<string, unknown>) => void]> = [
            [
                "formatVersion",
                (m) => {
                    m["formatVersion"] = 2;
                },
            ],
            [
                "codec",
                (m) => {
                    (m["producer"] as Record<string, unknown>)["cacheCodec"] = "json-brotli-v1";
                },
            ],
            [
                "modelVersion",
                (m) => {
                    (m["producer"] as Record<string, unknown>)["catalogModelVersion"] = "cm2";
                },
            ],
        ];
        for (const [expected, mutate] of cases) {
            const manifest = structuredClone(validManifest()) as unknown as Record<string, unknown>;
            mutate(manifest);
            const result = validateManifest(manifest);
            expect(result.ok).to.equal(false);
            if (result.ok === false) {
                expect(result.reason).to.equal(expected);
            }
        }
    });

    test("structural damage ⇒ shape (missing key, bad readiness state, wrong payload file)", () => {
        for (const mutate of [
            (m: Record<string, unknown>) => {
                delete m["key"];
            },
            (m: Record<string, unknown>) => {
                (m["readiness"] as Record<string, unknown>)["objects"] = "great";
            },
            (m: Record<string, unknown>) => {
                (m["payload"] as Record<string, unknown>)["file"] = "catalog.bin";
            },
            (m: Record<string, unknown>) => {
                delete m["writerId"];
            },
        ]) {
            const manifest = structuredClone(validManifest()) as unknown as Record<string, unknown>;
            mutate(manifest);
            const result = validateManifest(manifest);
            expect(result.ok).to.equal(false);
            if (result.ok === false) {
                expect(result.reason).to.equal("shape");
            }
        }
    });
});
