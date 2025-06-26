/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import * as sinon from "sinon";
import { expect } from "chai";

import { AddFirewallRuleWebviewController } from "../../src/controllers/addFirewallRuleWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { FirewallService } from "../../src/firewall/firewallService";
import { AddFirewallRuleState } from "../../src/sharedInterfaces/addFirewallRule";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as azureHelperStubs from "./azureHelperStubs";

suite("AddFirewallRuleWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: AddFirewallRuleWebviewController;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let mockFirewallService: TypeMoq.IMock<FirewallService>;
    const serverName = "TestServerName";
    const errorMessage = "Gotta have a firewall rule for 1.2.3.4 in order to access this server!";

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockFirewallService = TypeMoq.Mock.ofType(FirewallService, TypeMoq.MockBehavior.Loose);

        mockContext.setup((c) => c.extensionUri).returns(() => vscode.Uri.parse("file://fakePath"));
        mockContext.setup((c) => c.extensionPath).returns(() => "fakePath");
        mockContext.setup((c) => c.subscriptions).returns(() => []);

        mockFirewallService
            .setup((f) => f.handleFirewallRule(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve({ ipAddress: "1.2.3.4", result: true });
            });
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Initialization Tests", () => {
        test("Should initialize correctly for not signed into Azure", async () => {
            await finishSetup(false);

            const expectedInitialState: AddFirewallRuleState = {
                serverName: serverName,
                isSignedIn: false,
                tenants: [],
                clientIp: "1.2.3.4",
                message: errorMessage,
                addFirewallRuleState: ApiStatus.NotStarted,
            };

            expect(controller.state).to.deep.equal(
                expectedInitialState,
                "Initial state is incorrect",
            );
        });

        test("Should initialize correctly for signed into Azure", async () => {
            await finishSetup(true);

            const expectedInitialState: AddFirewallRuleState = {
                serverName: serverName,
                isSignedIn: true,
                tenants: azureHelperStubs.mockTenants.map((t) => {
                    return {
                        name: t.displayName,
                        id: t.tenantId,
                    };
                }),
                clientIp: "1.2.3.4",
                message: errorMessage,
                addFirewallRuleState: ApiStatus.NotStarted,
            };

            expect(controller.state).to.deep.equal(
                expectedInitialState,
                "Initial state is incorrect",
            );
        });
    });

    suite("Reducer tests", () => {
        test("closeDialog", async () => {
            await finishSetup();

            await controller["_reducerHandlers"].get("closeDialog")(controller.state, {});

            expect(controller.isDisposed).to.be.true;
            expect(await controller.dialogResult).to.be.false;
        });
    });

    async function finishSetup(isSignedIn: boolean = true): Promise<void> {
        azureHelperStubs.stubIsSignedIn(sandbox, isSignedIn);

        if (isSignedIn) {
            azureHelperStubs.stubConfirmVscodeAzureSignin(sandbox);
        }

        controller = new AddFirewallRuleWebviewController(
            mockContext.object,
            mockVscodeWrapper.object,
            {
                serverName: serverName,
                errorMessage: errorMessage,
            },
            mockFirewallService.object,
        );

        return await controller.initialized;
    }
});
