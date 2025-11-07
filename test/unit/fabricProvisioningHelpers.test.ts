/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import { AzureController } from "../../src/azure/azureController";
import * as fabricHelpers from "../../src/deployment/fabricProvisioningHelpers";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { stubTelemetry } from "./utils";
import { FormItemOptions, FormItemType } from "../../src/sharedInterfaces/form";
import * as fp from "../../src/sharedInterfaces/fabricProvisioning";
import { Fabric } from "../../src/constants/locConstants";

suite("Fabric Provisioning logic", () => {
    let sandbox: sinon.SinonSandbox;
    let deploymentController: any;
    let logger: any;
    let sendActionEvent: sinon.SinonStub;
    let accountOptions = [{ label: "acct1", id: "account1" }];
    let tenantOptions = [{ displayName: "tenant1", tenantId: "tenant1" }];
    let groupOptions: FormItemOptions[] = [{ displayName: "Default Group", value: "default" }];
    let updateStateStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(VsCodeAzureHelper, "getAccounts").resolves(accountOptions);
        sandbox.stub(VsCodeAzureHelper, "getTenantsForAccount").resolves(tenantOptions as any);
        sandbox.stub(AzureController, "isTokenValid").resolves(true);
        updateStateStub = sandbox.stub();

        ({ sendActionEvent } = stubTelemetry(sandbox));

        deploymentController = {
            mainController: {
                azureAccountService: {
                    getAccounts: sandbox.stub().resolves([{ displayInfo: { userId: "account1" } }]),
                    getAccountSecurityToken: sandbox.stub(),
                    addAccount: sandbox.stub().resolves({
                        key: { id: "newAccountId" },
                    }),
                },
            },
            state: { formState: {} },
            updateState: updateStateStub,
        };
        logger = { verbose: sandbox.stub(), error: sandbox.stub(), log: sandbox.stub() };
    });

    teardown(() => {
        sandbox.restore();
    });

    test("initializeFabricProvisioningState sets defaults", async () => {
        const state = await fabricHelpers.initializeFabricProvisioningState(
            deploymentController,
            groupOptions,
            logger,
            undefined,
        );

        expect(state.loadState).to.equal(ApiStatus.Loaded);
        expect(state.formState.accountId).to.equal("account1");
        expect(state.formState.tenantId).to.equal("tenant1");
        expect(state.formState.groupId).to.equal("default");
        expect(state.formComponents.accountId).to.be.ok;
        expect(state.formComponents.tenantId).to.be.ok;
        expect(state.formComponents.groupId).to.be.ok;

        expect(sendActionEvent.calledOnce).to.be.ok;
    });

    test("initializeFabricProvisioningState sets group id", async () => {
        const state = await fabricHelpers.initializeFabricProvisioningState(
            deploymentController,
            groupOptions,
            logger,
            "testGroup",
        );

        expect(state.loadState).to.equal(ApiStatus.Loaded);
        expect(state.formState.accountId).to.equal("account1");
        expect(state.formState.tenantId).to.equal("tenant1");
        expect(state.formState.groupId).to.equal("testGroup");
        expect(state.formComponents.accountId).to.be.ok;
        expect(state.formComponents.tenantId).to.be.ok;
        expect(state.formComponents.groupId).to.be.ok;

        expect(sendActionEvent.calledOnce).to.be.ok;
    });

    test("setFabricProvisioningFormComponents builds expected keys and validates fields", async () => {
        const azureAccounts = [{ displayName: "acct1", value: "account1" }];
        const azureActionButtons = [
            { id: "azureSignIn", label: "Sign in", callback: async () => {} },
        ];
        const groups = [{ displayName: "Default Group", value: "default" }];
        const tenants = [{ displayName: "tenant1", value: "tenant1" }];

        const formComponents = fabricHelpers.setFabricProvisioningFormComponents(
            azureAccounts,
            azureActionButtons,
            groups,
            tenants,
        );

        const expectedKeys = [
            "accountId",
            "workspace",
            "databaseName",
            "tenantId",
            "databaseDescription",
            "profileName",
            "groupId",
        ];

        expect(Object.keys(formComponents)).to.deep.equal(expectedKeys);

        // accountId component
        const accountId = formComponents.accountId;
        expect(accountId.propertyName).to.equal("accountId");
        expect(accountId.required).to.equal(true);
        expect(accountId.type).to.equal(FormItemType.Dropdown);
        expect(accountId.options.length).to.equal(1);
        expect(accountId.options[0].value).to.equal("account1");
        expect(accountId.actionButtons.length).to.equal(1);

        // workspace component
        const workspace = formComponents.workspace;
        expect(workspace.propertyName).to.equal("workspace");
        expect(workspace.required).to.equal(true);
        expect(workspace.type).to.equal(FormItemType.SearchableDropdown);
        expect(Array.isArray(workspace.options)).to.be.ok;

        // databaseName component
        const dbName = formComponents.databaseName;
        expect(dbName.propertyName).to.equal("databaseName");
        expect(dbName.required).to.equal(true);
        expect(dbName.type).to.equal(FormItemType.Input);

        // tenantId component
        const tenantId = formComponents.tenantId;
        expect(tenantId.propertyName).to.equal("tenantId");
        expect(tenantId.required).to.equal(true);
        expect(tenantId.type).to.equal(FormItemType.Dropdown);
        expect(tenantId.options.length).to.equal(1);
        expect(tenantId.options[0].value).to.equal("tenant1");

        // databaseDescription component
        const dbDesc = formComponents.databaseDescription;
        expect(dbDesc.propertyName).to.equal("databaseDescription");
        expect(dbDesc.required).to.equal(false);

        // profileName component
        const profileName = formComponents.profileName;
        expect(profileName.propertyName).to.equal("profileName");
        expect(profileName.type).to.equal(FormItemType.Input);

        // groupId component
        const groupId = formComponents.groupId;
        expect(groupId.propertyName).to.equal("groupId");
        expect(Array.isArray(groupId.options)).to.be.ok;

        // Validation examples
        let result = accountId.validate({} as fp.FabricProvisioningState, "account1");
        expect(result.isValid).to.equal(true);
        result = accountId.validate({} as fp.FabricProvisioningState, "");
        expect(result.isValid).to.equal(false);

        result = tenantId.validate({} as fp.FabricProvisioningState, "tenant1");
        expect(result.isValid).to.equal(true);
        result = tenantId.validate({} as fp.FabricProvisioningState, "");
        expect(result.isValid).to.equal(false);

        result = dbName.validate(
            { databaseNamesInWorkspace: ["db1", "db2"] } as fp.FabricProvisioningState,
            "db1",
        );
        expect(result.isValid).to.equal(false);
        result = dbName.validate(
            { databaseNamesInWorkspace: ["db1", "db2"] } as fp.FabricProvisioningState,
            "db3",
        );
        expect(result.isValid).to.equal(true);
        result = dbName.validate({} as fp.FabricProvisioningState, "");
        expect(result.isValid).to.equal(false);

        result = workspace.validate({} as fp.FabricProvisioningState, "");
        expect(result.isValid).to.equal(false);
        result = workspace.validate(
            {
                workspacesWithPermissions: { workspace1: undefined },
            } as unknown as fp.FabricProvisioningState,
            "workspace1",
        );
        expect(result.isValid).to.equal(true);
        result = workspace.validate(
            {
                workspacesWithPermissions: {},
            } as unknown as fp.FabricProvisioningState,
            "workspace1",
        );
        expect(result.isValid).to.equal(false);
    });

    test("loadComponentsAfterSignIn updates tenants, action buttons, and reloads components", async () => {
        // Initial state with missing tenant2 to test reset
        const state = {
            formState: { accountId: "account1", tenantId: "tenantX" },
            formComponents: {
                accountId: { actionButtons: [] },
                tenantId: { options: [] },
            },
            formErrors: [] as string[],
        } as fp.FabricProvisioningState;

        deploymentController.state.deploymentTypeState = state;

        // Stub dependencies
        deploymentController.validateDeploymentForm = sandbox.stub().resolves(["tenantId"]);

        // Call the function
        await fabricHelpers.loadComponentsAfterSignIn(deploymentController, logger);
        const tenantOptions = [{ displayName: "tenant1", value: "tenant1" }];

        expect(state.formComponents.tenantId.options).to.deep.equal(tenantOptions);
        expect(state.formState.tenantId).to.equal("tenant1");
        expect(state.formErrors).to.deep.equal(["tenantId"]);
        expect(state.formComponents.accountId.actionButtons[0].id).to.equal("azureSignIn");
    });

    test("reloadFabricComponents resets state and calls dependencies", async () => {
        const initialState = {
            capacityIds: new Set(["oldCapacity"]),
            userGroupIds: new Set(["oldGroup"]),
            workspaces: ["ws1", "ws2"],
            databaseNamesInWorkspace: ["db1"],
            formState: { tenantId: "tenant1", accountId: "account1" },
        } as unknown as fp.FabricProvisioningState;

        deploymentController.state.deploymentTypeState = initialState;

        const result = await fabricHelpers.reloadFabricComponents(deploymentController, "tenant1");

        // Check that sets and arrays were reset
        expect(Array.from(result.userGroupIds)).to.deep.equal([]);
        expect(result.workspaces).to.deep.equal([]);
        expect(result.databaseNamesInWorkspace).to.deep.equal([]);

        // Check that updateFabricProvisioningState was called
        expect(updateStateStub.calledOnce).to.be.ok;
    });

    test("getWorkspaceOptions returns correct options based on permissions", () => {
        const state = {
            workspacesWithPermissions: {
                ws1: {
                    id: "ws1",
                    displayName: "Workspace 1",
                    hasCapacityPermissionsForProvisioning: true,
                },
            },
            workspacesWithoutPermissions: {
                ws2: {
                    id: "ws2",
                    displayName: "Workspace 2",
                    hasCapacityPermissionsForProvisioning: true,
                },
                ws3: {
                    id: "ws3",
                    displayName: "Workspace 3",
                    hasCapacityPermissionsForProvisioning: false,
                },
            },
        } as unknown as fp.FabricProvisioningState;

        const options = fabricHelpers.getWorkspaceOptions(state);

        // ws1 has permission
        expect(options[0].value).to.equal("ws1");
        expect(options[0].color).to.deep.equal("");
        expect(options[0].description).to.equal("");

        // ws2 has no workspace permission
        expect(options[1].value).to.equal("ws2");
        expect(options[1].description).to.equal(Fabric.insufficientWorkspacePermissions);
        expect(options[1].icon).to.equal("Warning20Regular");
    });

    test("getWorkspaces updates state with workspace options", async () => {
        // Initial state with missing tenant2 to test reset
        const state = {
            formState: { accountId: "account1", tenantId: "tenantX" },
            formComponents: {
                accountId: { actionButtons: [] },
                tenantId: { options: [] },
            },
            formErrors: [] as string[],
        } as fp.FabricProvisioningState;

        deploymentController.state.deploymentTypeState = state;

        // Call the function
        await fabricHelpers.getWorkspaces(deploymentController);
    });
});
