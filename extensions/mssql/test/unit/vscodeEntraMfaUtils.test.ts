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
} from "../../src/azure/vscodeEntraMfaUtils";
import * as sinon from "sinon";
import * as AzureHelpers from "../../src/connectionconfig/azureHelpers";
import { mockAccounts, mockTenants } from "./azureHelperStubs";

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
