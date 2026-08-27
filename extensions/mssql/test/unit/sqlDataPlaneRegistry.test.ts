/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * FOUND-1/FOUND-2 (web addendum §3.1-3.5, TSQ2 addendum §3): shared provider
 * registry, capability model, and acceptance/error contracts.
 *
 * Pinned behaviors: unknown kind is a typed failure (never a local fallback);
 * single-flight startup with retry after failure; passive status constructs
 * nothing; requiredCapabilities (and profile-derived auth requirements) are
 * evaluated BEFORE any factory create or credential provider runs; sessions
 * are explicitly registered/finalized; struct↔id projections cannot drift.
 */

import { expect } from "chai";
import {
    DataPlaneErrorCodes,
    ISqlConnectionService,
    SqlBackendCapabilities,
    SqlCapabilityRequirement,
    SqlConnectionProfileRef,
    SqlDataPlaneError,
} from "../../src/services/sqlDataPlane/api";
import {
    ALL_CAPABILITY_IDS,
    STRUCT_FIELD_TO_CAPABILITY,
    answerFromSet,
    booleanProjection,
    capabilitySet,
    evaluateRequirements,
    mergeCapabilitySets,
    setFromNegotiated,
    supported,
    unsupported,
} from "../../src/services/sqlDataPlane/capabilityRegistry";
import {
    DataPlaneConfigReader,
    SqlBackendFactory,
    normalizeBackendKind,
} from "../../src/services/sqlDataPlane/backendFactory";
import { SqlDataPlaneService } from "../../src/services/sqlDataPlane/sqlDataPlaneService";
import { FakeBackend } from "../../src/services/sqlDataPlane/fakeBackend";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROFILE: SqlConnectionProfileRef = {
    profileFingerprint: "fp_reg",
    server: "localhost",
    authKind: "sql",
    user: "sa",
};

class TestConfig implements DataPlaneConfigReader {
    constructor(private readonly values = new Map<string, unknown>()) {}
    set(key: string, value: unknown): void {
        this.values.set(key, value);
    }
    get<T>(section: string, defaultValue: T): T {
        return this.values.has(section) ? (this.values.get(section) as T) : defaultValue;
    }
}

interface TestFactoryHooks {
    createCalls: number;
    failNextCreate?: Error;
    deferCreate?: Promise<void>;
}

function testFactory(
    kind: "fake" | "ts-native",
    hooks: TestFactoryHooks,
    staticOverrides?: Parameters<typeof capabilitySet>[0],
): SqlBackendFactory {
    return {
        kind,
        displayName: `test-${kind}`,
        realmClass: "local",
        identity: {
            kind,
            implementation: "fake",
            transport: "inprocess",
            driver: "fake",
            deployment: "test",
            realmId: "local",
            providerVersion: "0",
        },
        staticCapabilities: capabilitySet({
            "auth.sqlLogin": supported("static"),
            "exec.streamingRows": supported("static"),
            ...staticOverrides,
        }),
        fingerprintSettings: [`test.${kind}.knob`],
        create: async (): Promise<ISqlConnectionService> => {
            hooks.createCalls++;
            if (hooks.deferCreate) {
                await hooks.deferCreate;
            }
            if (hooks.failNextCreate) {
                const error = hooks.failNextCreate;
                delete hooks.failNextCreate;
                throw error;
            }
            return new FakeBackend({});
        },
    };
}

function makeService(config: TestConfig, ...factories: SqlBackendFactory[]): SqlDataPlaneService {
    return new SqlDataPlaneService(config, factories, "test");
}

// ---------------------------------------------------------------------------
// Capability model
// ---------------------------------------------------------------------------

suite("SQL Data Plane capability model (FOUND-2)", () => {
    const fullStruct: Required<SqlBackendCapabilities> = {
        protocolVersion: "2.0",
        streamingRows: true,
        creditBackpressure: true,
        cancel: true,
        dispose: true,
        oneActiveQueryPerSession: true,
        multipleResultSets: true,
        serverMessagesVerbatim: true,
        rowsAffectedStructured: true,
        executionPlanXml: false,
        estimatedPlan: true,
        actualPlan: true,
        typedCells: true,
        maxCellBytesHonored: true,
        pageRowsHonored: false,
        pageBytesHonored: true,
        queryTimeoutHonored: true,
        compactRows: true,
        vectorBinaryV1: false,
        spatialWkbV1: true,
        captureControl: false,
        replayDescriptors: true,
        resumeAfterDisconnect: false,
        metadataEndpoints: false,
    };

    test("every boolean struct field has a capability id and round-trips", () => {
        const structFields = Object.keys(fullStruct).filter((k) => k !== "protocolVersion");
        for (const field of structFields) {
            const id = STRUCT_FIELD_TO_CAPABILITY[field as keyof typeof STRUCT_FIELD_TO_CAPABILITY];
            expect(id, `struct field ${field} must map to a capability id`).to.be.a("string");
            expect(ALL_CAPABILITY_IDS).to.include(id);
        }
        const projected = booleanProjection(setFromNegotiated(fullStruct), "2.0");
        expect(projected).to.deep.equal(fullStruct);
    });

    test("evaluateRequirements: support, fidelity floors, limits, unknown ids", () => {
        const set = capabilitySet({
            "exec.streamingRows": supported("handshake"),
            "types.decimalExact": {
                support: "supported",
                fidelity: "normalized",
                source: "static",
            },
            "exec.windowPages": supported("static", "exact", { limit: 4, unit: "pages" }),
            "auth.integrated": unsupported("static", "driver.noIntegratedAuth"),
        });
        expect(evaluateRequirements(set, undefined).ok).to.equal(true);
        expect(
            evaluateRequirements(set, [{ id: "exec.streamingRows", require: "supported" }]).ok,
        ).to.equal(true);

        const authFail = evaluateRequirements(set, [
            { id: "auth.integrated", require: "supported" },
        ]);
        expect(authFail.ok).to.equal(false);
        expect(authFail.missing).to.deep.equal(["auth.integrated"]);
        expect(authFail.missingDetail?.[0].reasonCode).to.equal("driver.noIntegratedAuth");

        // fidelity floor: normalized satisfies normalized, not exact
        expect(
            evaluateRequirements(set, [{ id: "types.decimalExact", fidelityAtLeast: "normalized" }])
                .ok,
        ).to.equal(true);
        expect(
            evaluateRequirements(set, [{ id: "types.decimalExact", fidelityAtLeast: "exact" }]).ok,
        ).to.equal(false);

        // numeric minimum
        expect(evaluateRequirements(set, [{ id: "exec.windowPages", minimum: 4 }]).ok).to.equal(
            true,
        );
        expect(evaluateRequirements(set, [{ id: "exec.windowPages", minimum: 8 }]).ok).to.equal(
            false,
        );

        // unknown id never satisfies a hard requirement
        expect(
            evaluateRequirements(set, [{ id: "types.jsonNative", require: "supported" }]).ok,
        ).to.equal(false);
    });

    test("mergeCapabilitySets: later sources win per id", () => {
        const merged = mergeCapabilitySets(
            capabilitySet({
                "types.vectorBinaryV1": unsupported("static", "negotiatedAtInitialize"),
                "auth.sqlLogin": supported("static"),
            }),
            capabilitySet({ "types.vectorBinaryV1": supported("handshake") }),
        );
        expect(merged.values["types.vectorBinaryV1"]?.support).to.equal("supported");
        expect(merged.values["types.vectorBinaryV1"]?.source).to.equal("handshake");
        expect(merged.values["auth.sqlLogin"]?.support).to.equal("supported");
    });

    test("answerFromSet: supported/conditional/unsupported and opt-in flags", () => {
        const set = capabilitySet({
            "types.vectorBinaryV1": supported("handshake"),
            "types.spatialWkbV1": { support: "conditional", source: "static" },
            "auth.integrated": unsupported("static", "driver.noIntegratedAuth"),
        });
        const vector = answerFromSet(set, "types.vectorBinaryV1");
        expect(vector.supported).to.equal(true);
        expect(vector.requiresOptIn).to.equal(true);
        expect(answerFromSet(set, "types.spatialWkbV1").supported).to.equal("unknown");
        const integrated = answerFromSet(set, "auth.integrated");
        expect(integrated.supported).to.equal(false);
        expect(integrated.reason?.code).to.equal("driver.noIntegratedAuth");
        expect(answerFromSet(set, "types.jsonNative").supported).to.equal("unknown");
    });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

suite("SQL Data Plane backend registry (FOUND-1)", () => {
    test("kind normalization: alias accepted, unknown rejected typed", () => {
        expect(normalizeBackendKind("sts2-jsonrpc")).to.equal("sts2-local");
        expect(normalizeBackendKind("sts2-local")).to.equal("sts2-local");
        expect(normalizeBackendKind("ts-native")).to.equal("ts-native");
        expect(normalizeBackendKind("bogus")).to.equal(undefined);

        const config = new TestConfig();
        config.set("mssql.sqlDataPlane.backend", "bogus");
        const service = makeService(config, testFactory("fake", { createCalls: 0 }));
        expect(() => service.defaultBackendKind()).to.throw(SqlDataPlaneError);
        try {
            service.defaultBackendKind();
        } catch (error) {
            expect((error as SqlDataPlaneError).code).to.equal(DataPlaneErrorCodes.invalidRequest);
        }
    });

    test("duplicate factory registration is a programming error", () => {
        const service = makeService(new TestConfig(), testFactory("fake", { createCalls: 0 }));
        expect(() => service.registerFactory(testFactory("fake", { createCalls: 0 }))).to.throw(
            SqlDataPlaneError,
        );
    });

    test("single-flight startup; failed startup is retryable", async () => {
        const hooks: TestFactoryHooks = { createCalls: 0 };
        let releaseCreate!: () => void;
        hooks.deferCreate = new Promise((resolve) => (releaseCreate = resolve));
        const config = new TestConfig();
        config.set("mssql.sqlDataPlane.backend", "fake");
        const service = makeService(config, testFactory("fake", hooks));

        const first = service.service();
        const second = service.service();
        releaseCreate();
        await Promise.all([first, second]);
        expect(hooks.createCalls).to.equal(1);

        // Failure clears the single flight and surfaces on the entry.
        const failing: TestFactoryHooks = { createCalls: 0 };
        failing.failNextCreate = new Error("boom");
        const config2 = new TestConfig();
        config2.set("mssql.sqlDataPlane.backend", "ts-native");
        const service2 = makeService(config2, testFactory("ts-native", failing));
        let threw = false;
        try {
            await service2.service();
        } catch {
            threw = true;
        }
        expect(threw).to.equal(true);
        const failedEntry = service2.entrySnapshots().find((entry) => entry.kind === "ts-native");
        expect(failedEntry?.state).to.equal("failed");
        expect(failedEntry?.lastError?.code).to.equal(DataPlaneErrorCodes.providerInternal);

        await service2.service(); // retry succeeds
        expect(failing.createCalls).to.equal(2);
    });

    test("passive status constructs nothing", () => {
        const hooks: TestFactoryHooks = { createCalls: 0 };
        const config = new TestConfig();
        config.set("mssql.sqlDataPlane.enabled", true);
        config.set("mssql.sqlDataPlane.backend", "fake");
        const service = makeService(config, testFactory("fake", hooks));
        const summary = service.statusSummary();
        expect(summary.normalizedBackend).to.equal("fake");
        expect((summary.entries as unknown[]).length).to.equal(1);
        expect(hooks.createCalls).to.equal(0);
    });

    test("multi-local coexistence with per-session provider binding", async () => {
        const fakeHooks: TestFactoryHooks = { createCalls: 0 };
        const nativeHooks: TestFactoryHooks = { createCalls: 0 };
        const config = new TestConfig();
        config.set("mssql.sqlDataPlane.backend", "fake");
        const service = makeService(
            config,
            testFactory("fake", fakeHooks),
            testFactory("ts-native", nativeHooks),
        );

        const defaultSession = await (
            await service.service()
        ).openSession({
            profile: PROFILE,
            applicationName: "test",
        });
        const overrideSession = await (
            await service.service({ backendKind: "ts-native" })
        ).openSession({ profile: PROFILE, applicationName: "test" });

        expect(fakeHooks.createCalls).to.equal(1);
        expect(nativeHooks.createCalls).to.equal(1);
        const counts = Object.fromEntries(
            service.entrySnapshots().map((entry) => [entry.kind, entry.activeSessionCount]),
        );
        expect(counts).to.deep.equal({ fake: 1, "ts-native": 1 });

        // Explicit finalization via close(); double-finalize stays at 0.
        await defaultSession.close();
        await defaultSession.dispose();
        await overrideSession.close();
        const after = Object.fromEntries(
            service.entrySnapshots().map((entry) => [entry.kind, entry.activeSessionCount]),
        );
        expect(after).to.deep.equal({ fake: 0, "ts-native": 0 });
        await service.dispose();
    });

    test("config change drains only the affected entry (stale swap at zero sessions)", async () => {
        const hooks: TestFactoryHooks = { createCalls: 0 };
        const config = new TestConfig();
        config.set("mssql.sqlDataPlane.backend", "fake");
        config.set("test.fake.knob", 1);
        const service = makeService(config, testFactory("fake", hooks));

        const session = await (
            await service.service()
        ).openSession({
            profile: PROFILE,
            applicationName: "test",
        });
        expect(hooks.createCalls).to.equal(1);

        config.set("test.fake.knob", 2);
        service.handleConfigurationChanged();
        // Session still open: entry marked stale, service NOT recomposed yet.
        expect(service.entrySnapshots()[0].staleConfig).to.equal(true);
        expect(hooks.createCalls).to.equal(1);

        await session.close();
        // Finalization triggers the deferred swap; next service() recreates.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await service.service();
        expect(hooks.createCalls).to.equal(2);
        await service.dispose();
    });

    test("credential tripwire: requirements fail BEFORE create and BEFORE providers", async () => {
        const hooks: TestFactoryHooks = { createCalls: 0 };
        const config = new TestConfig();
        config.set("mssql.sqlDataPlane.backend", "ts-native");
        // ts-native-like factory WITHOUT auth.integrated; sts2-local-like
        // alternative WITH it.
        const service = makeService(
            config,
            testFactory("ts-native", hooks),
            testFactory("fake", { createCalls: 0 }, { "auth.integrated": supported("static") }),
        );

        let passwordCalls = 0;
        let tokenCalls = 0;
        const integratedProfile: SqlConnectionProfileRef = {
            ...PROFILE,
            authKind: "integrated",
        };

        const check = await service.canOpen({
            profile: integratedProfile,
            applicationName: "test",
        });
        expect(check.ok).to.equal(false);
        expect(check.missing).to.deep.equal(["auth.integrated"]);
        expect(check.alternatives).to.deep.equal(["fake"]);

        let thrown: SqlDataPlaneError | undefined;
        try {
            await service.openSession({
                profile: integratedProfile,
                applicationName: "test",
                auth: {
                    passwordProvider: async () => {
                        passwordCalls++;
                        return "secret";
                    },
                    tokenProvider: async () => {
                        tokenCalls++;
                        return "token";
                    },
                },
            });
        } catch (error) {
            thrown = error as SqlDataPlaneError;
        }
        expect(thrown?.code).to.equal(DataPlaneErrorCodes.capabilityUnsupported);
        expect(hooks.createCalls).to.equal(0, "factory.create must not run");
        expect(passwordCalls).to.equal(0, "passwordProvider must not run");
        expect(tokenCalls).to.equal(0, "tokenProvider must not run");
    });

    test("explicit requiredCapabilities are enforced with alternatives", async () => {
        const config = new TestConfig();
        config.set("mssql.sqlDataPlane.backend", "ts-native");
        const service = makeService(
            config,
            testFactory("ts-native", { createCalls: 0 }),
            testFactory("fake", { createCalls: 0 }, { "types.spatialWkbV1": supported("static") }),
        );
        const requirements: SqlCapabilityRequirement[] = [
            { id: "types.spatialWkbV1", require: "supported" },
        ];
        const check = await service.canOpen({
            profile: PROFILE,
            applicationName: "test",
            requiredCapabilities: requirements,
        });
        expect(check.ok).to.equal(false);
        expect(check.missing).to.deep.equal(["types.spatialWkbV1"]);
        expect(check.alternatives).to.deep.equal(["fake"]);
    });

    test("capability oracle: provider/any answers with alternatives", () => {
        const config = new TestConfig();
        const service = makeService(
            config,
            testFactory("ts-native", { createCalls: 0 }),
            testFactory("fake", { createCalls: 0 }, { "auth.integrated": supported("static") }),
        );
        const provider = service.providerSupports("ts-native", "auth.integrated");
        expect(provider.supported).to.equal("unknown"); // absent from statement
        const any = service.anyProviderSupports("auth.integrated");
        expect(any.supported).to.equal(true);
        expect(any.alternatives).to.deep.equal(["fake"]);
        expect(service.anyProviderSupports("types.jsonNative").supported).to.equal(false);
    });

    test("acceptance always settles on the fake provider (FOUND-2)", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: "SELECT 1",
                    events: [
                        { type: "resultSet", columns: ["a"], rows: [[1]] },
                        { type: "complete", status: "succeeded" },
                    ],
                },
            ],
        });
        const session = await backend.openSession({
            profile: PROFILE,
            applicationName: "test",
        });
        const handle = session.execute(
            "SELECT 1",
            {},
            {
                onResultSetStarted: () => undefined,
                onRowsPage: () => undefined,
                onMessage: () => undefined,
                onComplete: () => undefined,
            },
        );
        const acceptance = await handle.accepted;
        expect(acceptance.status).to.equal("accepted");
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        await session.close();
    });
});
