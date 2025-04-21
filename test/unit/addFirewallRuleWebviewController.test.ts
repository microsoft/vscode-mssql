/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { expect } from "chai";
import { AddFirewallRuleWebviewController } from "../../src/controllers/addFirewallRuleWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { FirewallService } from "../../src/firewall/firewallService";
import { AddFirewallRuleState } from "../../src/sharedInterfaces/addFirewallRule";
import { ApiStatus } from "../../src/sharedInterfaces/webview";

suite("AddFirewallRuleWebviewController Tests", () => {
    let controller: AddFirewallRuleWebviewController;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let mockFirewallService: TypeMoq.IMock<FirewallService>;
    const serverName = "TestServerName";
    const errorMessage = "Gotta have a firewall rule for 1.2.3.4 in order to access this server!";

    setup(async () => {
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();

        controller = new AddFirewallRuleWebviewController(
            mockContext.object,
            mockVscodeWrapper.object,
            {
                serverName: serverName,
                errorMessage: errorMessage,
            },
            mockFirewallService.object,
        );

        await controller.initialized;
    });

    test("Should initialize correctly", () => {
        const expectedInitialState: AddFirewallRuleState = {
            serverName: serverName,
            isSignedIn: false,
            tenants: [],
            clientIp: "1.2.3.4",
            message: "",
            addFirewallRuleState: ApiStatus.NotStarted,
        };

        expect(controller.state).to.deep.equal(expectedInitialState, "Initial state is incorrect");
    });
});
