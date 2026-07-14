/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2 §9: the SQL Data Plane Debug Console projection. Pins the privacy
 * contract (raw last-error message never crosses the wire) and the shaping of
 * the passive registry snapshot into the typed page contract.
 */

import { expect } from "chai";
import { projectSqlDataPlaneStatus } from "../../src/services/sqlDataPlane/debugConsoleStatus";

const NOW = 1_783_900_000_000;

suite("SQL Data Plane Debug Console projection (TSQ2 §9)", () => {
    test("drops the raw last-error message; keeps only code/retryable/serverErrorNumber", () => {
        const status = projectSqlDataPlaneStatus({
            summary: {
                enabled: true,
                backend: "ts-native",
                normalizedBackend: "ts-native",
                availability: { state: "available", backend: "ts-native" },
                activeSessions: 2,
                entries: [
                    {
                        kind: "ts-native",
                        displayName: "Native TypeScript (tedious)",
                        state: "failed",
                        realmClass: "local",
                        activeSessionCount: 0,
                        staleConfig: false,
                        lastError: {
                            code: "SqlDataPlane.Auth",
                            // The message names the server + user — must NOT survive.
                            message: "Login failed for user 'sa' on server prod-sql-07.contoso.com",
                            retryable: false,
                            server: { number: 18456 },
                        },
                    },
                ],
                details: {},
            },
            observability: { terminals: 5, invariantViolations: 0, droppedAfterTerminal: 0 },
            nowEpochMs: NOW,
        });

        const raw = JSON.stringify(status);
        expect(raw).to.not.contain("prod-sql-07");
        expect(raw).to.not.contain("Login failed");
        expect(raw).to.not.contain("'sa'");

        const entry = status.entries[0];
        expect(entry.lastError).to.deep.equal({
            code: "SqlDataPlane.Auth",
            retryable: false,
            serverErrorNumber: 18456,
        });
    });

    test("shapes the passive summary into the typed contract", () => {
        const status = projectSqlDataPlaneStatus({
            summary: {
                enabled: true,
                backend: "ts-nativ", // misconfigured -> normalized differs
                normalizedBackend: "INVALID(ts-nativ)",
                availability: { state: "unavailable", reason: "node too old", retryable: false },
                activeSessions: 0,
                entries: [
                    {
                        kind: "sts2-local",
                        displayName: "SQL Tools Service",
                        state: "ready",
                        realmClass: "local",
                        activeSessionCount: 1,
                        staleConfig: true,
                    },
                ],
                details: { "ts-native": { driver: { name: "tedious", version: "20.0.0" } } },
            },
            observability: { terminals: 0, invariantViolations: 2, droppedAfterTerminal: 3 },
            nowEpochMs: NOW,
        });

        expect(status.capturedEpochMs).to.equal(NOW);
        expect(status.enabled).to.equal(true);
        expect(status.backend).to.equal("ts-nativ");
        expect(status.normalizedBackend).to.equal("INVALID(ts-nativ)");
        expect(status.availability).to.deep.equal({
            state: "unavailable",
            reason: "node too old",
            retryable: false,
        });
        expect(status.entries[0].staleConfig).to.equal(true);
        expect(status.entries[0].lastError).to.equal(undefined);
        expect(status.tsNativeObservability).to.deep.equal({
            terminals: 0,
            invariantViolations: 2,
            droppedAfterTerminal: 3,
        });
        expect(status.details).to.have.property("ts-native");
    });

    test("tolerates a missing/empty summary without throwing", () => {
        const status = projectSqlDataPlaneStatus({ summary: {}, nowEpochMs: NOW });
        expect(status.enabled).to.equal(false);
        expect(status.availability.state).to.equal("unknown");
        expect(status.entries).to.deep.equal([]);
        expect(status.details).to.deep.equal({});
        expect(status.tsNativeObservability).to.equal(undefined);
        expect(status.environment).to.equal(undefined);
        expect(status.capabilities).to.equal(undefined);
        expect(status.rememberedFallbacks).to.equal(undefined);
    });

    test("carries env facts, fallback policy, remembered routes, and the capability matrix", () => {
        const status = projectSqlDataPlaneStatus({
            summary: { enabled: true, backend: "ts-native", normalizedBackend: "ts-native" },
            nowEpochMs: NOW,
            fallbackPolicy: "prompt",
            environment: {
                node: "22.9.0",
                platform: "win32",
                arch: "x64",
                extensionVersion: "1.44.0",
                settings: { "mssql.sqlDataPlane.backend": "ts-native" },
            },
            rememberedFallbacks: [{ profileFingerprint: "fp_win", backendKind: "sts2-local" }],
            capabilities: {
                "ts-native": {
                    "auth.integrated": {
                        support: "unsupported",
                        reasonCode: "driver.noIntegratedAuth",
                        source: "static",
                    },
                    "exec.windowPages": {
                        support: "supported",
                        fidelity: "exact",
                        limit: 4,
                        unit: "pages",
                        source: "static",
                    },
                },
            },
        });

        expect(status.fallbackPolicy).to.equal("prompt");
        expect(status.environment?.node).to.equal("22.9.0");
        expect(status.environment?.platform).to.equal("win32");
        expect(status.rememberedFallbacks).to.deep.equal([
            { profileFingerprint: "fp_win", backendKind: "sts2-local" },
        ]);
        expect(status.capabilities?.["ts-native"]["auth.integrated"]).to.deep.equal({
            support: "unsupported",
            reasonCode: "driver.noIntegratedAuth",
            source: "static",
        });
        expect(status.capabilities?.["ts-native"]["exec.windowPages"]).to.deep.equal({
            support: "supported",
            fidelity: "exact",
            limit: 4,
            unit: "pages",
            source: "static",
        });
    });
});
