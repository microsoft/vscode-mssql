/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";

import { AddFirewallRuleWebviewController } from "../../src/controllers/addFirewallRuleWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { FirewallService } from "../../src/firewall/firewallService";
import { AddFirewallRuleState } from "../../src/sharedInterfaces/addFirewallRule";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as azureHelperStubs from "./azureHelperStubs";
import { stubVscodeWrapper } from "./utils";

suite("AddFirewallRuleWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: AddFirewallRuleWebviewController;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockFirewallService: sinon.SinonStubbedInstance<FirewallService>;

    const serverName = "TestServerName";
    const errorMessage = "Gotta have a firewall rule for 1.2.3.4 in order to access this server!";

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockFirewallService = sandbox.createStubInstance(FirewallService);

        mockContext = {
            extensionUri: vscode.Uri.parse("file://fakePath"),
            extensionPath: "fakePath",
            subscriptions: [],
        } as vscode.ExtensionContext;

        mockFirewallService.handleFirewallRule.returns(
            Promise.resolve({ ipAddress: "1.2.3.4", result: true }),
        );
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
                accounts: [],
                tenants: {},
                clientIp: "1.2.3.4",
                message: errorMessage,
                addFirewallRuleStatus: ApiStatus.NotStarted,
            };

            expect(controller.state).to.deep.equal(
                expectedInitialState,
                "Initial state is incorrect",
            );
        });

        test("Should initialize correctly for signed into Azure", async () => {
            azureHelperStubs.stubVscodeAzureHelperGetAccounts(sandbox);

            await finishSetup(true);

            const expectedInitialState: AddFirewallRuleState = {
                serverName: serverName,
                isSignedIn: true,
                accounts: azureHelperStubs.mockAccounts.map((a) => {
                    return {
                        accountId: a.id,
                        displayName: a.label,
                    };
                }),
                tenants: {
                    [azureHelperStubs.mockAccounts[0].id]: azureHelperStubs.mockTenants
                        .filter((t) => t.account.id === azureHelperStubs.mockAccounts[0].id)
                        .map((t) => {
                            return {
                                displayName: t.displayName,
                                tenantId: t.tenantId,
                            };
                        }),
                },
                clientIp: "1.2.3.4",
                message: errorMessage,
                addFirewallRuleStatus: ApiStatus.NotStarted,
            };

            expect(controller.state).to.deep.equal(
                expectedInitialState,
                "Initial state is incorrect",
            );
        });
    });

    suite("Reducer tests", () => {
        test("closeDialog", async () => {
            await finishSetup(false /* isSignedIn */);

            await controller["_reducerHandlers"].get("closeDialog")(controller.state, {});

            expect(controller.isDisposed).to.be.true;
            expect(await controller.dialogResult).to.be.false;
        });

        test("addFirewallRule should preserve state when error occurs", async () => {
            await finishSetup(true /* isSignedIn */);

            // Simulate an error during firewall rule creation
            mockFirewallService.createFirewallRuleWithVscodeAccount.rejects(
                new Error("Network error"),
            );

            const originalState = { ...controller.state };
            const firewallRuleSpec = {
                name: "CustomRuleName",
                azureAccountInfo: { accountId: "account1", tenantId: "tenant1" },
                ip: "192.168.1.100",
            };

            // Execute the addFirewallRule reducer
            const newState = await controller["_reducerHandlers"].get("addFirewallRule")(
                originalState,
                { firewallRuleSpec },
            );

            // Verify that the error is reflected in state
            expect(newState.addFirewallRuleStatus).to.equal(ApiStatus.Error);
            expect(newState.message).to.equal("Network error");

            // Verify that other state properties are preserved
            expect(newState.serverName).to.equal(originalState.serverName);
            expect(newState.clientIp).to.equal(originalState.clientIp);
            expect(newState.isSignedIn).to.equal(originalState.isSignedIn);
            expect(newState.accounts).to.deep.equal(originalState.accounts);
            expect(newState.tenants).to.deep.equal(originalState.tenants);
        });
    });

    async function finishSetup(isSignedIn: boolean = true): Promise<void> {
        azureHelperStubs.stubIsSignedIn(sandbox, isSignedIn);

        if (isSignedIn) {
            azureHelperStubs.stubVscodeAzureSignIn(sandbox);
        }

        controller = new AddFirewallRuleWebviewController(
            mockContext,
            mockVscodeWrapper,
            {
                serverName: serverName,
                errorMessage: errorMessage,
            },
            mockFirewallService,
        );

        return await controller.initialized;
    }
});
