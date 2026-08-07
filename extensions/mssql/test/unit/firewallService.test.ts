/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import { FirewallService, IHandleFirewallRuleResponse } from "../../src/firewall/firewallService";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";

chai.use(sinonChai);

suite("Firewall Service Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let firewallService: FirewallService;

    setup(() => {
        sandbox = sinon.createSandbox();
        firewallService = new FirewallService();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("handleFirewallRule", () => {
        test("extracts the blocked IP address from an Azure firewall error", async () => {
            const handleResult = await firewallService.handleFirewallRule(
                40615,
                "Client with IP address '128.0.0.0' is not allowed to access the server.",
            );

            expect(handleResult).to.deep.equal({
                result: true,
                ipAddress: "128.0.0.0",
            } satisfies IHandleFirewallRuleResponse);
        });

        test("returns failure when the error code is not an Azure firewall error", async () => {
            const handleResult = await firewallService.handleFirewallRule(
                18456,
                "Login failed for user.",
            );

            expect(handleResult).to.deep.equal({ result: false, ipAddress: "" });
        });

        test("returns failure when an Azure firewall error has no IP address", async () => {
            const handleResult = await firewallService.handleFirewallRule(
                40615,
                "The client is not allowed to access the server.",
            );

            expect(handleResult).to.deep.equal({ result: false, ipAddress: "" });
        });
    });

    test("creates firewall rule using the matching Azure subscription", async () => {
        const subscription = {
            subscriptionId: "subscription-id",
            tenantId: "tenant-id",
        } as AzureSubscription;
        const firewallRuleSpec = {
            name: "Test Rule",
            azureAccountInfo: {
                accountId: "account-id",
                tenantId: "tenant-id",
            },
            ip: {
                startIp: "1.2.3.1",
                endIp: "1.2.3.255",
            },
        };
        sandbox.stub(VsCodeAzureHelper, "findSqlResource").resolves({
            accountId: "account-id",
            subscriptionId: "subscription-id",
            resourceGroup: "resource-group",
        });
        sandbox.stub(VsCodeAzureHelper, "getSubscriptionsForAccount").resolves([subscription]);
        const createFirewallRule = sandbox.stub(VsCodeAzureHelper, "createFirewallRule").resolves();

        await firewallService.createFirewallRuleWithVscodeAccount(
            firewallRuleSpec,
            "test-server.database.windows.net,1433",
        );

        expect(VsCodeAzureHelper.findSqlResource).to.have.been.calledWithExactly(
            "account-id",
            "test-server",
        );
        expect(VsCodeAzureHelper.getSubscriptionsForAccount).to.have.been.calledWithExactly(
            "account-id",
        );
        expect(createFirewallRule).to.have.been.calledWithExactly(
            subscription,
            "resource-group",
            "test-server",
            "Test Rule",
            "1.2.3.1",
            "1.2.3.255",
        );
    });

    test("reports an error when the Azure SQL server cannot be located", async () => {
        sandbox.stub(VsCodeAzureHelper, "findSqlResource").resolves("UnableToCheck");
        const getSubscriptions = sandbox.stub(VsCodeAzureHelper, "getSubscriptionsForAccount");
        const createFirewallRule = sandbox.stub(VsCodeAzureHelper, "createFirewallRule");

        const firewallRuleSpec = {
            name: "Test Rule",
            azureAccountInfo: {
                accountId: "account-id",
                tenantId: "tenant-id",
            },
            ip: "1.2.3.4",
        };

        try {
            await firewallService.createFirewallRuleWithVscodeAccount(
                firewallRuleSpec,
                "missing-server",
            );
            expect.fail("Expected firewall rule creation to throw");
        } catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            expect(error.message).to.contain("Unable to locate Azure SQL server 'missing-server'");
        }
        expect(getSubscriptions).not.to.have.been.called;
        expect(createFirewallRule).not.to.have.been.called;
    });
});
