/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { FirewallService } from "../../src/firewall/firewallService";
import { AccountService } from "../../src/azure/accountService";
import {
    HandleFirewallRuleRequest,
    IHandleFirewallRuleResponse,
} from "../../src/models/contracts/firewall/firewallRequest";
import * as Constants from "../../src/constants/constants";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";

chai.use(sinonChai);

suite("Firewall Service Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let accountService: sinon.SinonStubbedInstance<AccountService>;
    let firewallService: FirewallService;

    setup(() => {
        sandbox = sinon.createSandbox();
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        accountService = sandbox.createStubInstance(AccountService);

        sandbox.stub(accountService, "client").get(() => client);
        firewallService = new FirewallService(accountService);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Handle Firewall Rule test", async () => {
        const mockResponse: IHandleFirewallRuleResponse = {
            result: true,
            ipAddress: "128.0.0.0",
        };
        client.sendResourceRequest.resolves(mockResponse);

        const handleResult = await firewallService.handleFirewallRule(12345, "firewall error!");

        expect(handleResult).to.deep.equal(mockResponse);
        expect(client.sendResourceRequest).to.have.been.calledOnceWithExactly(
            HandleFirewallRuleRequest.type,
            {
                errorCode: 12345,
                errorMessage: "firewall error!",
                connectionTypeId: Constants.mssqlProviderName,
            },
        );
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

        await firewallService.createFirewallRuleWithVscodeAccount(firewallRuleSpec, "test-server");

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
