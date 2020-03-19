/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import SqlToolsServiceClient from '../src/languageservice/serviceclient';
import { FirewallService } from '../src/firewall/firewallService';
import { HandleFirewallRuleRequest, IHandleFirewallRuleResponse,
    CreateFirewallRuleRequest, ICreateFirewallRuleResponse, IHandleFirewallRuleParams } from '../src/models/contracts/firewall/firewallRequest';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import { assert } from 'chai';
import { IAzureSession } from '../src/models/interfaces';


suite('Firewall Service Tests', () => {
    let firewallService: FirewallService;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(() => {
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        let mockHandleFirewallResponse: IHandleFirewallRuleResponse = {
            result: true,
            ipAddress: '128.0.0.0'
        };
        let mockCreateFirewallRuleResponse: ICreateFirewallRuleResponse = {
            result: true,
            errorMessage: ''
        };
        client.setup(c => c.sendResourceRequest(HandleFirewallRuleRequest.type, TypeMoq.It.isAny())).returns(() => Promise.resolve(mockHandleFirewallResponse));
        client.setup(c => c.sendResourceRequest(CreateFirewallRuleRequest.type,
            TypeMoq.It.isAny())).returns(() => Promise.resolve(mockCreateFirewallRuleResponse));
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        let mockSession: IAzureSession = {
            environment: undefined,
            userId: 'test',
            tenantId: 'test',
            credentials: undefined
        };
        let mockExtension: vscode.Extension<any> = {
            id: '',
            extensionKind: undefined,
            extensionPath: '',
            isActive: true,
            packageJSON: undefined,
            activate: undefined,
            exports: {
                sessions: [mockSession]
            }
        };
        vscodeWrapper.setup(v => v.azureAccountExtension).returns(() => mockExtension);
        firewallService = new FirewallService(client.object, vscodeWrapper.object);
    });

    test('isSignedIn Test', () => {
        let isSignedIn = firewallService.isSignedIn;
        assert.isNotTrue(isSignedIn, 'Firewall Service should not be signed in initially');
        firewallService.isSignedIn = true;
        assert.isTrue(firewallService.isSignedIn, 'Firewall Service should be signed in once set');
    });

    test('Handle Firewall Rule test', async () => {
        let result = await firewallService.handleFirewallRule(12345, 'firewall error!');
        assert.isNotNull(result, 'Handle Firewall Rule request is sent successfully');
    });

    test('Create Firewall Rule Test', async () => {
        let server = 'test_server';
        let startIpAddress = '1.2.3.1';
        let endIpAddress = '1.2.3.255';
        firewallService.isSignedIn = true;
        let mockToken = {
            expiresOn: new Date(),
            resource: undefined,
            tokenType: 'test',
            accessToken: 'test_token'
        };
        firewallService.token = mockToken;
        let result = await firewallService.createFirewallRule(server, startIpAddress, endIpAddress);
        assert.isNotNull(result, 'Create Firewall Rule request is sent successfully');
    });
});

