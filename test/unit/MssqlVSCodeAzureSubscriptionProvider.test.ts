/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { MssqlVSCodeAzureSubscriptionProvider } from "../../src/azure/MssqlVSCodeAzureSubscriptionProvider";

suite("MssqlVSCodeAzureSubscriptionProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let configStub: {
        get: sinon.SinonStub;
        has: sinon.SinonStub;
        inspect: sinon.SinonStub;
        update: sinon.SinonStub;
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        configStub = {
            get: sandbox.stub(),
            has: sandbox.stub(),
            inspect: sandbox.stub(),
            update: sandbox.stub(),
        };
        sandbox.stub(vscode.workspace, "getConfiguration").returns(configStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Filter Methods", () => {
        test("getTenantFilters extracts tenant IDs from composite keys", async () => {
            const mockFilterConfig = [
                "account1@example.com/tenant1/subscription1",
                "account2@example.com/tenant2/subscription2",
                "account1@example.com/tenant1/subscription3",
            ];

            configStub.get
                .withArgs("mssql.selectedAzureSubscriptions", sinon.match.any)
                .returns(mockFilterConfig);

            const provider = MssqlVSCodeAzureSubscriptionProvider.getInstance();
            const tenantFilters = await provider["getTenantFilters"]();

            expect(tenantFilters).to.have.lengthOf(3);
            expect(tenantFilters).to.include("tenant1");
            expect(tenantFilters).to.include("tenant2");
        });

        test("getSubscriptionFilters extracts subscription IDs from composite keys", async () => {
            const mockFilterConfig = [
                "account1@example.com/tenant1/subscription1",
                "account2@example.com/tenant2/subscription2",
                "account1@example.com/tenant1/subscription3",
            ];

            configStub.get
                .withArgs("mssql.selectedAzureSubscriptions", sinon.match.any)
                .returns(mockFilterConfig);

            const provider = MssqlVSCodeAzureSubscriptionProvider.getInstance();
            const subscriptionFilters = await provider["getSubscriptionFilters"]();

            expect(subscriptionFilters).to.have.lengthOf(3);
            expect(subscriptionFilters).to.include("subscription1");
            expect(subscriptionFilters).to.include("subscription2");
            expect(subscriptionFilters).to.include("subscription3");
        });

        test("getTenantFilters handles empty configuration", async () => {
            configStub.get
                .withArgs("mssql.selectedAzureSubscriptions", sinon.match.any)
                .returns([]);

            const provider = MssqlVSCodeAzureSubscriptionProvider.getInstance();
            const tenantFilters = await provider["getTenantFilters"]();

            expect(tenantFilters).to.be.an("array").that.is.empty;
        });

        test("getSubscriptionFilters handles empty configuration", async () => {
            configStub.get
                .withArgs("mssql.selectedAzureSubscriptions", sinon.match.any)
                .returns([]);

            const provider = MssqlVSCodeAzureSubscriptionProvider.getInstance();
            const subscriptionFilters = await provider["getSubscriptionFilters"]();

            expect(subscriptionFilters).to.be.an("array").that.is.empty;
        });

        test("filters correctly handle duplicate subscriptions from different accounts", async () => {
            // Same subscription accessible from two different accounts
            const mockFilterConfig = [
                "account1@example.com/shared-tenant/shared-subscription",
                "account2@example.com/shared-tenant/shared-subscription",
            ];

            configStub.get
                .withArgs("mssql.selectedAzureSubscriptions", sinon.match.any)
                .returns(mockFilterConfig);

            const provider = MssqlVSCodeAzureSubscriptionProvider.getInstance();
            const subscriptionFilters = await provider["getSubscriptionFilters"]();

            // Should return both entries (even though subscription ID is the same)
            // because they're from different accounts
            expect(subscriptionFilters).to.have.lengthOf(2);
            expect(subscriptionFilters[0]).to.equal("shared-subscription");
            expect(subscriptionFilters[1]).to.equal("shared-subscription");
        });

        test("filters correctly parse complex email addresses", async () => {
            const mockFilterConfig = [
                "user+tag@company.com/tenant-guid-1/subscription-guid-1",
                "user.name@sub.domain.com/tenant-guid-2/subscription-guid-2",
            ];

            configStub.get
                .withArgs("mssql.selectedAzureSubscriptions", sinon.match.any)
                .returns(mockFilterConfig);

            const provider = MssqlVSCodeAzureSubscriptionProvider.getInstance();

            const tenantFilters = await provider["getTenantFilters"]();
            expect(tenantFilters).to.have.lengthOf(2);
            expect(tenantFilters).to.include("tenant-guid-1");
            expect(tenantFilters).to.include("tenant-guid-2");

            const subscriptionFilters = await provider["getSubscriptionFilters"]();
            expect(subscriptionFilters).to.have.lengthOf(2);
            expect(subscriptionFilters).to.include("subscription-guid-1");
            expect(subscriptionFilters).to.include("subscription-guid-2");
        });

        test("getTenantFilters handles malformed filter strings gracefully", async () => {
            const mockFilterConfig = [
                "account1@example.com/tenant1/subscription1",
                "malformed-string", // No slashes
                "account2@example.com/tenant2", // Missing subscription ID (only 2 parts)
            ];

            configStub.get
                .withArgs("mssql.selectedAzureSubscriptions", sinon.match.any)
                .returns(mockFilterConfig);

            const provider = MssqlVSCodeAzureSubscriptionProvider.getInstance();
            const tenantFilters = await provider["getTenantFilters"]();

            // Should still extract what it can, even with malformed entries
            expect(tenantFilters).to.have.lengthOf(3);
            expect(tenantFilters[0]).to.equal("tenant1");
            expect(tenantFilters[1]).to.be.undefined; // malformed-string.split("/")[1]
            expect(tenantFilters[2]).to.equal("tenant2");
        });

        test("getSubscriptionFilters handles malformed filter strings gracefully", async () => {
            const mockFilterConfig = [
                "account1@example.com/tenant1/subscription1",
                "malformed-string", // No slashes
                "account2@example.com/tenant2", // Missing subscription ID (only 2 parts)
            ];

            configStub.get
                .withArgs("mssql.selectedAzureSubscriptions", sinon.match.any)
                .returns(mockFilterConfig);

            const provider = MssqlVSCodeAzureSubscriptionProvider.getInstance();
            const subscriptionFilters = await provider["getSubscriptionFilters"]();

            // Should still extract what it can, even with malformed entries
            expect(subscriptionFilters).to.have.lengthOf(3);
            expect(subscriptionFilters[0]).to.equal("subscription1");
            expect(subscriptionFilters[1]).to.be.undefined; // malformed-string.split("/")[2]
            expect(subscriptionFilters[2]).to.be.undefined; // "account2@example.com/tenant2".split("/")[2]
        });
    });
});
