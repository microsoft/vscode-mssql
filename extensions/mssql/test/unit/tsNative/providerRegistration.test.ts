/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as path from "path";
import { DataPlaneConfigReader } from "../../../src/services/sqlDataPlane/backendFactory";
import { DataPlaneErrorCodes, SqlDataPlaneError } from "../../../src/services/sqlDataPlane/api";
import { SqlDataPlaneService } from "../../../src/services/sqlDataPlane/sqlDataPlaneService";
import { openWithServerlessWake } from "../../../src/services/sqlDataPlane/serverlessWake";
import * as providerEntry from "../../../src/services/tsNative/providerEntry";

suite("Native TypeScript provider registration", () => {
    const sandbox = sinon.createSandbox();
    let registry: SqlDataPlaneService;
    const values = new Map<string, unknown>();
    const config: DataPlaneConfigReader = {
        get: <T>(key: string, fallback: T): T =>
            values.has(key) ? (values.get(key) as T) : fallback,
    };

    setup(() => {
        values.clear();
        values.set("mssql.enableExperimentalFeatures", true);
        values.set("mssql.sqlDataPlane.enabled", true);
        registry = new SqlDataPlaneService(config);
    });
    teardown(async () => {
        await registry.dispose();
        sandbox.restore();
    });

    test("keeps STS as the default and reports native capabilities without loading either provider", () => {
        expect(registry.defaultBackendKind()).to.equal("sts2-local");
        expect(registry.providerSupports("ts-native", "auth.sqlLogin").supported).to.equal(true);
        expect(registry.providerSupports("ts-native", "auth.integrated").supported).to.equal(false);
        expect(registry.providerSupports("ts-native", "types.decimalExact").supported).to.equal(
            false,
        );
        expect(registry.entrySnapshots().every((entry) => entry.state === "idle")).to.equal(true);
    });

    test("selecting native loads it lazily and leaves STS idle", async () => {
        values.set("mssql.sqlDataPlane.backend", "ts-native");
        const provider = await registry.service();
        expect(provider.availability.state).to.equal("available");
        expect(
            registry.entrySnapshots().find((entry) => entry.kind === "ts-native")?.state,
        ).to.equal("running");
        expect(
            registry.entrySnapshots().find((entry) => entry.kind === "sts2-local")?.state,
        ).to.equal("idle");
    });

    test("unsupported authentication suggests STS before loading a driver or resolving credentials", async () => {
        values.set("mssql.sqlDataPlane.backend", "ts-native");
        const passwordProvider = sandbox.stub().rejects(new Error("Must not resolve credentials"));
        const params = {
            profile: {
                profileFingerprint: "integrated",
                server: "unused",
                authKind: "integrated" as const,
            },
            applicationName: "test",
            auth: { passwordProvider },
        };
        const capability = await registry.canOpen(params);
        expect(capability.ok).to.equal(false);
        expect(capability.alternatives).to.include("sts2-local");
        let failure: unknown;
        try {
            await registry.openSession(params);
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(SqlDataPlaneError);
        expect((failure as SqlDataPlaneError).code).to.equal(
            DataPlaneErrorCodes.capabilityUnsupported,
        );
        sinon.assert.notCalled(passwordProvider);
        expect(registry.entrySnapshots().every((entry) => entry.state === "idle")).to.equal(true);
    });

    test("disabled preview reports its gate without loading a provider", () => {
        values.set("mssql.sqlDataPlane.backend", "ts-native");
        values.set("mssql.enableExperimentalFeatures", false);
        // Callers gate activation on enabled. canOpen describes static
        // capabilities and deliberately does not test feature availability.
        expect(registry.enabled).to.equal(false);
        expect(registry.entrySnapshots().every((entry) => entry.state === "idle")).to.equal(true);
    });

    for (const category of ["timeout", "auth"] as const) {
        test(`preserves bundled ${category} errors across the factory and serverless retry boundary`, async () => {
            // Exercise the shipped chunk, whose error constructor is distinct
            // from the compiled unit-test/activation API constructor.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const bundled = require(
                path.resolve(__dirname, "../../../../dist/tsNativeProvider.js"),
            ) as typeof providerEntry;
            const backend = bundled.createBackend({
                overrides: { faults: { seed: 1, openFailure: category } },
            });
            const dispose = sandbox.spy(
                backend as typeof backend & { dispose(): Promise<void> },
                "dispose",
            );
            const params = {
                profile: {
                    profileFingerprint: "bundled-serverless",
                    server: "unused.database.windows.net",
                    database: "paused-db",
                    authKind: "aad" as const,
                    accountId: "test-account",
                },
                applicationName: "test",
                auth: { tokenProvider: async () => "test-token" },
            };
            const original = await backend.openSession(params).catch((error: unknown) => error);
            expect(original).to.be.instanceOf(Error).and.not.instanceOf(SqlDataPlaneError);
            sandbox.stub(providerEntry, "createBackend").returns(backend);
            values.set("mssql.sqlDataPlane.backend", "ts-native");
            const service = await registry.service();
            const open = sandbox.spy(service, "openSession");
            const error = await openWithServerlessWake(
                params.profile,
                () => service.openSession(params),
                { getStatus: async () => "Paused", delayMs: 0, maxRetryAttempts: 1 },
            ).catch((failure: unknown) => failure);
            expect(error).to.be.instanceOf(SqlDataPlaneError);
            expect(error).to.include({
                code:
                    category === "timeout"
                        ? DataPlaneErrorCodes.unavailable
                        : DataPlaneErrorCodes.auth,
                retryable: category === "timeout",
                message: (original as Error).message,
            });
            expect((error as SqlDataPlaneError).backend).to.deep.equal({ kind: "ts-native" });
            expect(open.callCount).to.equal(category === "timeout" ? 2 : 1);
            await registry.dispose();
            sinon.assert.calledOnce(dispose);
            expect(dispose.firstCall.thisValue).to.equal(backend);
        });
    }
});
