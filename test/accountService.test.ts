/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import SqlToolsServiceClient from '../src/languageservice/serviceclient';
import { AccountService } from '../src/azure/accountService';
import { HandleFirewallRuleRequest, IHandleFirewallRuleResponse,
    CreateFirewallRuleRequest, ICreateFirewallRuleResponse, IHandleFirewallRuleParams } from '../src/models/contracts/firewall/firewallRequest';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import { assert } from 'chai';
import { IAzureSession } from '../src/models/interfaces';


suite('Firewall Service Tests', () => {
    let accountService: AccountService;
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
            extensionUri: undefined,
            exports: {
                sessions: [mockSession]
            }
        };

        vscodeWrapper.setup(v => v.azureAccountExtension).returns(() => mockExtension);
        accountService = new AccountService(client.object, vscodeWrapper.object, undefined, undefined);
    });

});
