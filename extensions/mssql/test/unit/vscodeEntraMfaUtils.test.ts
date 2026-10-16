/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as vscode from "vscode";
import {
    areCompatibleEntraAccountIds,
    getVscodeEntraAccountOptions,
    acquireTokenFromVscodeAccountForResource,
    clearVscodeEntraTokenCache,
    isVscodeEntraTokenStale,
    resetVscodeEntraTokenCacheForTest,
} from "../../src/azure/vscodeEntraMfaUtils";
import * as sinon from "sinon";
import * as AzureHelpers from "../../src/connectionconfig/azureHelpers";
import { mockAccounts, mockTenants } from "./azureHelperStubs";
import { Logger } from "../../src/models/logger";

suite("vscodeEntraMfaUtils", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("gets account options without enumerating tenants", async () => {
        const getAccounts = sandbox
            .stub(AzureHelpers.VsCodeAzureHelper, "getAccounts")
            .resolves([mockAccounts.signedInAccount]);
        const getTenantsForAccount = sandbox.stub(
            AzureHelpers.VsCodeAzureHelper,
            "getTenantsForAccount",
        );

        const options = await getVscodeEntraAccountOptions();

        expect(options).to.deep.equal([
            {
                displayName: mockAccounts.signedInAccount.label,
                value: mockAccounts.signedInAccount.id,
            },
        ]);
        expect(getAccounts).to.have.been.calledWith(false);
        expect(getTenantsForAccount).to.not.have.been.called;
    });

    test("uses the selected tenant when tenant enumeration is unavailable", async () => {
        const selectedTenantId = "22222222-2222-2222-2222-222222222222";
        const tenantIdWithWhitespace = ` ${selectedTenantId} `;
        sandbox
            .stub(AzureHelpers.VsCodeAzureHelper, "getAccounts")
            .resolves([mockAccounts.signedInAccount]);
        const getTenantsForAccount = sandbox
            .stub(AzureHelpers.VsCodeAzureHelper, "getTenantsForAccount")
            .resolves([]);
        const getSession = sandbox.stub(vscode.authentication, "getSession").resolves({
            id: "session-id",
            accessToken: "access-token",
            account: mockAccounts.signedInAccount,
            scopes: [],
        });

        const result = await acquireTokenFromVscodeAccountForResource(
            "https://database.windows.net/",
            mockAccounts.signedInAccount.id,
            tenantIdWithWhitespace,
        );

        expect(result.tenantId).to.equal(selectedTenantId);
        expect(getTenantsForAccount).to.not.have.been.called;
        expect(getSession).to.have.been.called;
    });

    test("resolves the default tenant when the selected tenant is whitespace", async () => {
        const expectedTenantId = AzureHelpers.getDefaultTenantId(
            mockAccounts.signedInAccount.id,
            mockTenants,
        );
        sandbox
            .stub(AzureHelpers.VsCodeAzureHelper, "getAccounts")
            .resolves([mockAccounts.signedInAccount]);
        const getTenantsForAccount = sandbox
            .stub(AzureHelpers.VsCodeAzureHelper, "getTenantsForAccount")
            .resolves(mockTenants);
        sandbox.stub(vscode.authentication, "getSession").resolves({
            id: "session-id",
            accessToken: "access-token",
            account: mockAccounts.signedInAccount,
            scopes: [],
        });

        const result = await acquireTokenFromVscodeAccountForResource(
            "https://database.windows.net/",
            mockAccounts.signedInAccount.id,
            "   ",
        );

        expect(result.tenantId).to.equal(expectedTenantId);
        expect(getTenantsForAccount).to.have.been.calledOnceWith(mockAccounts.signedInAccount);
    });

    suite("after the token cache is cleared", () => {
        const resource = "https://database.windows.net/";
        const tenantId = "22222222-2222-2222-2222-222222222222";
        const clearedAt = 1_800_000_000;

        let getSession: sinon.SinonStub;

        setup(() => {
            sandbox
                .stub(AzureHelpers.VsCodeAzureHelper, "getAccounts")
                .resolves([mockAccounts.signedInAccount]);
            getSession = sandbox.stub(vscode.authentication, "getSession");
            sandbox.useFakeTimers({ now: clearedAt * 1000, toFake: ["Date"] });
            clearVscodeEntraTokenCache();
        });

        teardown(() => {
            resetVscodeEntraTokenCacheForTest();
        });

        function createSession(accessToken: string): vscode.AuthenticationSession {
            return {
                id: "session-id",
                accessToken,
                account: mockAccounts.signedInAccount,
                scopes: [],
            };
        }

        function expectedChallenge(time: number): string {
            const claims = `{"access_token":{"nbf":{"essential":true,"value":"${time}"}}}`;
            return `Bearer claims="${Buffer.from(claims).toString("base64")}"`;
        }

        function acquireToken() {
            return acquireTokenFromVscodeAccountForResource(
                resource,
                mockAccounts.signedInAccount.id,
                tenantId,
            );
        }

        test("re-requests the cached token with a claims challenge", async () => {
            getSession.onFirstCall().resolves(createSession("cached-token"));
            getSession.onSecondCall().resolves(createSession("refreshed-token"));

            const result = await acquireToken();

            expect(result.token.token).to.equal("refreshed-token");
            expect(getSession).to.have.been.calledTwice;
            const [, request, options] = getSession.secondCall.args;
            expect(request.wwwAuthenticate).to.equal(expectedChallenge(clearedAt));
            expect(request.fallbackScopes).to.include(`${resource}.default`);
            expect(request.fallbackScopes).to.include(`VSCODE_TENANT:${tenantId}`);
            expect(options).to.deep.include({
                silent: true,
                account: mockAccounts.signedInAccount,
            });
            expect(isVscodeEntraTokenStale("cached-token")).to.be.true;
            expect(isVscodeEntraTokenStale("refreshed-token")).to.be.false;
        });

        test("uses the refreshed token without another challenge", async () => {
            getSession.onFirstCall().resolves(createSession("cached-token"));
            getSession.onSecondCall().resolves(createSession("refreshed-token"));
            await acquireToken();
            getSession.reset();
            getSession.resolves(createSession("refreshed-token"));

            const result = await acquireToken();

            expect(result.token.token).to.equal("refreshed-token");
            expect(getSession).to.have.been.calledOnce;
        });

        test("challenges again if the provider returns the cached token again", async () => {
            getSession.onFirstCall().resolves(createSession("cached-token"));
            getSession.onSecondCall().resolves(createSession("refreshed-token"));
            await acquireToken();
            getSession.reset();
            getSession.onFirstCall().resolves(createSession("cached-token"));
            getSession.onSecondCall().resolves(createSession("refreshed-token"));

            const result = await acquireToken();

            expect(result.token.token).to.equal("refreshed-token");
            expect(getSession).to.have.been.calledTwice;
            expect(getSession.secondCall.args[1].wwwAuthenticate).to.equal(
                expectedChallenge(clearedAt),
            );
        });

        test("uses a different challenge after another clear", async () => {
            getSession.onFirstCall().resolves(createSession("cached-token"));
            getSession.onSecondCall().resolves(createSession("refreshed-token"));
            await acquireToken();
            getSession.reset();
            sandbox.clock.tick(60_000);
            clearVscodeEntraTokenCache();
            getSession.onFirstCall().resolves(createSession("refreshed-token"));
            getSession.onSecondCall().resolves(createSession("refreshed-again-token"));

            const result = await acquireToken();

            expect(result.token.token).to.equal("refreshed-again-token");
            expect(getSession.secondCall.args[1].wwwAuthenticate).to.equal(
                expectedChallenge(clearedAt + 60),
            );
            expect(isVscodeEntraTokenStale("refreshed-token")).to.be.true;
        });

        test("warns when VS Code returns the cached token after a forced refresh", async () => {
            const warn = sandbox.stub(Logger.prototype, "warn");
            getSession.resolves(createSession("cached-token"));

            const result = await acquireToken();

            expect(result.token.token).to.equal("cached-token");
            expect(warn).to.have.been.calledWithMatch("returned the cached token");
            expect(isVscodeEntraTokenStale("cached-token")).to.be.true;
        });

        test("uses a different challenge for another clear in the same second", async () => {
            getSession.onFirstCall().resolves(createSession("cached-token"));
            getSession.onSecondCall().resolves(createSession("refreshed-token"));
            await acquireToken();
            getSession.reset();
            clearVscodeEntraTokenCache();
            getSession.onFirstCall().resolves(createSession("refreshed-token"));
            getSession.onSecondCall().resolves(createSession("refreshed-again-token"));

            await acquireToken();

            expect(getSession.secondCall.args[1].wwwAuthenticate).to.equal(
                expectedChallenge(clearedAt + 1),
            );
        });

        test("keeps a token stale if the cache is cleared during its refresh", async () => {
            getSession.onFirstCall().resolves(createSession("cached-token"));
            getSession.onSecondCall().callsFake(async () => {
                clearVscodeEntraTokenCache();
                return createSession("refreshed-token");
            });

            await acquireToken();

            expect(isVscodeEntraTokenStale("refreshed-token")).to.be.true;
        });

        test("does not treat a missing token as stale", () => {
            expect(isVscodeEntraTokenStale(undefined)).to.be.false;
        });
    });

    suite("areCompatibleEntraAccountIds", () => {
        test("returns true for exact match", () => {
            expect(areCompatibleEntraAccountIds("user@example.com", "user@example.com")).to.be.true;
        });

        test("returns true when currentAccountId starts with expectedAccountId (legacy prefix)", () => {
            // Legacy account IDs may have extra suffixes appended (e.g. "|tenantId")
            expect(areCompatibleEntraAccountIds("user@example.com|tenant-abc", "user@example.com"))
                .to.be.true;
        });

        test("returns true when expectedAccountId starts with currentAccountId (reverse legacy prefix)", () => {
            expect(areCompatibleEntraAccountIds("user@example.com", "user@example.com|tenant-abc"))
                .to.be.true;
        });

        test("returns false when ids share a common prefix but neither is a prefix of the other", () => {
            expect(areCompatibleEntraAccountIds("account-abc-1", "account-abc-2")).to.be.false;
        });

        test("returns true when one id is a strict prefix of the other (potential ambiguous prefix case)", () => {
            // IDs like "user@example.com" and "user@example.com2" where the former is a prefix of
            // the latter. The function uses startsWith so these are treated as compatible.
            // This documents the known behavior for cases where legacy IDs differ by a suffix.
            expect(areCompatibleEntraAccountIds("user@example.com", "user@example.com|tenant-123"))
                .to.be.true;
            expect(areCompatibleEntraAccountIds("user@example.com|tenant-123", "user@example.com"))
                .to.be.true;
        });

        test("returns false when currentAccountId is undefined", () => {
            expect(areCompatibleEntraAccountIds(undefined, "user@example.com")).to.be.false;
        });

        test("returns false when expectedAccountId is undefined", () => {
            expect(areCompatibleEntraAccountIds("user@example.com", undefined)).to.be.false;
        });

        test("returns false when both ids are undefined", () => {
            expect(areCompatibleEntraAccountIds(undefined, undefined)).to.be.false;
        });

        test("returns false for completely different ids", () => {
            expect(areCompatibleEntraAccountIds("user1@example.com", "user2@example.com")).to.be
                .false;
        });
    });
});
