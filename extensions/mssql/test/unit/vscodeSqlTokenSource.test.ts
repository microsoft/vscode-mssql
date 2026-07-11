/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { VscodeEntraSqlTokenInfo } from "../../src/azure/vscodeEntraMfaUtils";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import { VscodeSqlTokenSource } from "../../src/services/sqlDataPlane/vscodeSqlTokenSource";
import type { DiagEvent } from "../../src/sharedInterfaces/debugConsole";

function tokenInfo(
    token: string,
    accountId = "saved-account",
    tenantId = "saved-tenant",
    expiresOn = Math.floor(Date.now() / 1000) + 3600,
): VscodeEntraSqlTokenInfo {
    const account = { id: accountId, label: "ninja@example.test" };
    return {
        account,
        tenantId,
        session: { id: "session", accessToken: token, account, scopes: [] },
        token: {
            key: account.id,
            token,
            tokenType: "Bearer",
            expiresOn,
        },
    };
}

suite("VS Code SQL token source", () => {
    test("uses account/tenant/label, coalesces concurrent opens, and never diagnoses identity or token", async () => {
        const events: DiagEvent[] = [];
        const sinkId = `test-token-source-${Date.now()}`;
        diag.addSink({ id: sinkId, tryWrite: (event) => events.push(event) });
        let acquisitions = 0;
        let release!: (value: VscodeEntraSqlTokenInfo) => void;
        const pending = new Promise<VscodeEntraSqlTokenInfo>((resolve) => (release = resolve));
        const source = new VscodeSqlTokenSource(async (accountId, tenantId, accountLabel) => {
            acquisitions++;
            expect(accountId).to.equal("saved-account");
            expect(tenantId).to.equal("saved-tenant");
            expect(accountLabel).to.equal("ninja@example.test");
            return pending;
        });
        try {
            const profile = {
                authenticationType: "AzureMFA",
                email: "ninja@example.test",
                accountId: "saved-account",
                tenantId: "saved-tenant",
            };
            const first = source.acquireSqlAccessToken(profile);
            const second = source.acquireSqlAccessToken(profile);
            expect(acquisitions).to.equal(1);
            release(tokenInfo("token-canary-never-log"));
            expect(await first).to.equal("token-canary-never-log");
            expect(await second).to.equal("token-canary-never-log");

            const diagnosticJson = JSON.stringify(events);
            for (const forbidden of [
                "token-canary-never-log",
                "saved-account",
                "saved-tenant",
                "ninja@example.test",
            ]) {
                expect(diagnosticJson).to.not.include(forbidden);
            }
            expect(diagnosticJson).to.include("sqlDataPlane.auth.token");
            expect(diagnosticJson).to.include("sqlDataPlane.auth.token.coalesced");
        } finally {
            diag.removeSink(sinkId);
        }
    });

    test("returns undefined for an empty provider token", async () => {
        const source = new VscodeSqlTokenSource(async () => tokenInfo(""));
        expect(await source.acquireSqlAccessToken({ authenticationType: "AzureMFA" })).to.equal(
            undefined,
        );
    });

    test("rejects resolved account/tenant drift and a token too close to expiry", async () => {
        const profile = {
            authenticationType: "AzureMFA",
            email: "ninja@example.test",
            accountId: "saved-account",
            tenantId: "saved-tenant",
        };
        for (const [info, expectedName] of [
            [tokenInfo("token", "other-account"), "EntraAccountMismatchError"],
            [tokenInfo("token", "saved-account", "other-tenant"), "EntraTenantMismatchError"],
            [
                tokenInfo(
                    "token",
                    "saved-account",
                    "saved-tenant",
                    Math.floor(Date.now() / 1000) + 30,
                ),
                "EntraTokenExpiryError",
            ],
        ] as const) {
            const source = new VscodeSqlTokenSource(async () => info);
            try {
                await source.acquireSqlAccessToken(profile);
                expect.fail("identity/expiry mismatch should throw");
            } catch (error) {
                expect((error as Error).name).to.equal(expectedName);
            }
        }
    });

    test("provider failures emit only fixed diagnostics and clear single-flight state", async () => {
        const events: DiagEvent[] = [];
        const sinkId = `test-token-source-failure-${Date.now()}`;
        diag.addSink({ id: sinkId, tryWrite: (event) => events.push(event) });
        let acquisitions = 0;
        const source = new VscodeSqlTokenSource(async () => {
            acquisitions++;
            if (acquisitions === 1) {
                throw new Error(
                    "provider CANARY-token account-canary@example.test tenant-canary details",
                );
            }
            return tokenInfo("fresh-token");
        });
        const profile = {
            authenticationType: "AzureMFA",
            email: "ninja@example.test",
            accountId: "saved-account",
            tenantId: "saved-tenant",
        };
        try {
            await source.acquireSqlAccessToken(profile).catch(() => undefined);
            expect(await source.acquireSqlAccessToken(profile)).to.equal("fresh-token");
            expect(acquisitions).to.equal(2);
            const serialized = JSON.stringify(events);
            for (const forbidden of [
                "CANARY-token",
                "account-canary@example.test",
                "tenant-canary",
            ]) {
                expect(serialized).to.not.include(forbidden);
            }
            expect(serialized).to.include("acquisitionFailed");
        } finally {
            diag.removeSink(sinkId);
        }
    });
});
