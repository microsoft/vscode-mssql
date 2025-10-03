/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { FirewallService } from "../../src/firewall/firewallService";
import { AccountService } from "../../src/azure/accountService";
import {
    HandleFirewallRuleRequest,
    IHandleFirewallRuleResponse,
    CreateFirewallRuleRequest,
    ICreateFirewallRuleResponse,
} from "../../src/models/contracts/firewall/firewallRequest";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { assert } from "chai";
import { IAzureSession, IAzureResourceFilter } from "../../src/models/interfaces";
import {
    AzureAuthType,
    IAccount,
    ITenant,
    IToken,
    IAzureAccountProperties,
} from "../../src/models/contracts/azure";
import { getCloudProviderSettings } from "../../src/azure/providerSettings";

suite("Firewall Service Tests", () => {
    let firewallService: TypeMoq.IMock<FirewallService>;
    let accountService: TypeMoq.IMock<AccountService>;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(() => {
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        let mockHandleFirewallResponse: IHandleFirewallRuleResponse = {
            result: true,
            ipAddress: "128.0.0.0",
        };
        let mockCreateFirewallRuleResponse: ICreateFirewallRuleResponse = {
            result: true,
            errorMessage: "",
        };
        client
            .setup((c) => c.sendResourceRequest(HandleFirewallRuleRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockHandleFirewallResponse));
        client
            .setup((c) => c.sendResourceRequest(CreateFirewallRuleRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockCreateFirewallRuleResponse));
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        let mockSession: IAzureSession = {
            environment: undefined,
            userId: "test",
            tenantId: "test",
            credentials: undefined,
        };
        let mockSessions: IAzureSession[] = [mockSession];
        let mockFilter: IAzureResourceFilter = {
            sessions: mockSessions,
            subscription: undefined,
        };
        let mockExtension: vscode.Extension<any> = {
            id: "",
            extensionKind: undefined,
            extensionPath: "",
            isActive: true,
            packageJSON: undefined,
            activate: undefined,
            extensionUri: undefined,
            exports: {
                sessions: mockSessions,
                filters: mockFilter,
            },
        };
        vscodeWrapper.setup((v) => v.azureAccountExtension).returns(() => mockExtension);
        accountService = TypeMoq.Mock.ofType(AccountService, TypeMoq.MockBehavior.Loose);
        firewallService = TypeMoq.Mock.ofType(FirewallService, TypeMoq.MockBehavior.Loose);
    });

    test("Handle Firewall Rule test", async () => {
        let handleResult = await firewallService.object.handleFirewallRule(
            12345,
            "firewall error!",
        );
        assert.isNotNull(handleResult, "Handle Firewall Rule request is sent successfully");
    });

    test("Create Firewall Rule Test", async () => {
        let server = "test_server";
        let startIpAddress = "1.2.3.1";
        let endIpAddress = "1.2.3.255";
        let mockTenant: ITenant = {
            id: "1",
            displayName: undefined,
        };
        let properties: IAzureAccountProperties = {
            tenants: [mockTenant],
            azureAuthType: AzureAuthType.AuthCodeGrant,
            isMsAccount: false,
            owningTenant: {
                id: "1",
                displayName: undefined,
            },
            providerSettings: getCloudProviderSettings(),
        };
        let mockAccount: IAccount = {
            properties: properties,
            key: undefined,
            displayInfo: undefined,
            isStale: undefined,
        };
        let mockToken: IToken = {
            key: "",
            tokenType: "",
            token: "",
            expiresOn: 0,
        };
        accountService
            .setup((v) => v.refreshToken(mockAccount, mockTenant.id))
            .returns(() => Promise.resolve(mockToken));
        accountService.object.setAccount(mockAccount);
        let result = await firewallService.object.createFirewallRule({
            account: mockAccount,
            firewallRuleName: "Test Rule",
            startIpAddress: startIpAddress,
            endIpAddress: endIpAddress,
            serverName: server,
            securityTokenMappings: accountService.object.createSecurityTokenMapping(
                mockAccount,
                mockTenant.id,
            ),
        });
        assert.isNotNull(result, "Create Firewall Rule request is sent successfully");
    });
});
