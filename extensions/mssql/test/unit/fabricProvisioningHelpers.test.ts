/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
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
  let groupOptions: FormItemOptions[] = [
    { displayName: "Default Group", value: "default" },
  ];
  let updateStateStub: sinon.SinonStub;

  setup(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(VsCodeAzureHelper, "getAccounts").resolves(accountOptions);
    sandbox
      .stub(VsCodeAzureHelper, "getTenantsForAccount")
      .resolves(tenantOptions as any);
    sandbox.stub(AzureController, "isTokenValid").resolves(true);
    updateStateStub = sandbox.stub();

    ({ sendActionEvent } = stubTelemetry(sandbox));

    deploymentController = {
      mainController: {
        azureAccountService: {
          getAccounts: sandbox
            .stub()
            .resolves([{ displayInfo: { userId: "account1" } }]),
          getAccountSecurityToken: sandbox.stub(),
          addAccount: sandbox.stub().resolves({
            key: { id: "newAccountId" },
          }),
        },
      },
      state: { formState: {} },
      updateState: updateStateStub,
    };
    logger = {
      verbose: sandbox.stub(),
      error: sandbox.stub(),
      log: sandbox.stub(),
    };
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

    assert.strictEqual(state.loadState, ApiStatus.Loaded);
    assert.strictEqual(state.formState.accountId, "account1");
    assert.strictEqual(state.formState.tenantId, "tenant1");
    assert.strictEqual(state.formState.groupId, "default");
    assert.ok(state.formComponents.accountId);
    assert.ok(state.formComponents.tenantId);
    assert.ok(state.formComponents.groupId);

    assert.ok(sendActionEvent.calledOnce);
  });

  test("initializeFabricProvisioningState sets group id", async () => {
    const state = await fabricHelpers.initializeFabricProvisioningState(
      deploymentController,
      groupOptions,
      logger,
      "testGroup",
    );

    assert.strictEqual(state.loadState, ApiStatus.Loaded);
    assert.strictEqual(state.formState.accountId, "account1");
    assert.strictEqual(state.formState.tenantId, "tenant1");
    assert.strictEqual(state.formState.groupId, "testGroup");
    assert.ok(state.formComponents.accountId);
    assert.ok(state.formComponents.tenantId);
    assert.ok(state.formComponents.groupId);

    assert.ok(sendActionEvent.calledOnce);
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

    assert.deepStrictEqual(Object.keys(formComponents), expectedKeys);

    // accountId component
    const accountId = formComponents.accountId;
    assert.strictEqual(accountId.propertyName, "accountId");
    assert.strictEqual(accountId.required, true);
    assert.strictEqual(accountId.type, FormItemType.Dropdown);
    assert.strictEqual(accountId.options.length, 1);
    assert.strictEqual(accountId.options[0].value, "account1");
    assert.strictEqual(accountId.actionButtons.length, 1);

    // workspace component
    const workspace = formComponents.workspace;
    assert.strictEqual(workspace.propertyName, "workspace");
    assert.strictEqual(workspace.required, true);
    assert.strictEqual(workspace.type, FormItemType.SearchableDropdown);
    assert.ok(Array.isArray(workspace.options));

    // databaseName component
    const dbName = formComponents.databaseName;
    assert.strictEqual(dbName.propertyName, "databaseName");
    assert.strictEqual(dbName.required, true);
    assert.strictEqual(dbName.type, FormItemType.Input);

    // tenantId component
    const tenantId = formComponents.tenantId;
    assert.strictEqual(tenantId.propertyName, "tenantId");
    assert.strictEqual(tenantId.required, true);
    assert.strictEqual(tenantId.type, FormItemType.Dropdown);
    assert.strictEqual(tenantId.options.length, 1);
    assert.strictEqual(tenantId.options[0].value, "tenant1");

    // databaseDescription component
    const dbDesc = formComponents.databaseDescription;
    assert.strictEqual(dbDesc.propertyName, "databaseDescription");
    assert.strictEqual(dbDesc.required, false);

    // profileName component
    const profileName = formComponents.profileName;
    assert.strictEqual(profileName.propertyName, "profileName");
    assert.strictEqual(profileName.type, FormItemType.Input);

    // groupId component
    const groupId = formComponents.groupId;
    assert.strictEqual(groupId.propertyName, "groupId");
    assert.ok(Array.isArray(groupId.options));

    // Validation examples
    let result = accountId.validate(
      {} as fp.FabricProvisioningState,
      "account1",
    );
    assert.strictEqual(result.isValid, true);
    result = accountId.validate({} as fp.FabricProvisioningState, "");
    assert.strictEqual(result.isValid, false);

    result = tenantId.validate({} as fp.FabricProvisioningState, "tenant1");
    assert.strictEqual(result.isValid, true);
    result = tenantId.validate({} as fp.FabricProvisioningState, "");
    assert.strictEqual(result.isValid, false);

    result = dbName.validate(
      {
        databaseNamesInWorkspace: ["db1", "db2"],
      } as fp.FabricProvisioningState,
      "db1",
    );
    assert.strictEqual(result.isValid, false);
    result = dbName.validate(
      {
        databaseNamesInWorkspace: ["db1", "db2"],
      } as fp.FabricProvisioningState,
      "db3",
    );
    assert.strictEqual(result.isValid, true);
    result = dbName.validate({} as fp.FabricProvisioningState, "");
    assert.strictEqual(result.isValid, false);

    result = workspace.validate({} as fp.FabricProvisioningState, "");
    assert.strictEqual(result.isValid, false);
    result = workspace.validate(
      {
        workspacesWithPermissions: { workspace1: undefined },
      } as unknown as fp.FabricProvisioningState,
      "workspace1",
    );
    assert.strictEqual(result.isValid, true);
    result = workspace.validate(
      {
        workspacesWithPermissions: {},
      } as unknown as fp.FabricProvisioningState,
      "workspace1",
    );
    assert.strictEqual(result.isValid, false);
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
    deploymentController.validateDeploymentForm = sandbox
      .stub()
      .resolves(["tenantId"]);

    // Call the function
    await fabricHelpers.loadComponentsAfterSignIn(deploymentController, logger);
    const tenantOptions = [{ displayName: "tenant1", value: "tenant1" }];

    assert.deepStrictEqual(
      state.formComponents.tenantId.options,
      tenantOptions,
    );
    assert.strictEqual(state.formState.tenantId, "tenant1");
    assert.deepStrictEqual(state.formErrors, ["tenantId"]);
    assert.strictEqual(
      state.formComponents.accountId.actionButtons[0].id,
      "azureSignIn",
    );
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

    const result = await fabricHelpers.reloadFabricComponents(
      deploymentController,
      "tenant1",
    );

    // Check that sets and arrays were reset
    assert.deepStrictEqual(Array.from(result.userGroupIds), []);
    assert.deepStrictEqual(result.workspaces, []);
    assert.deepStrictEqual(result.databaseNamesInWorkspace, []);

    // Check that updateFabricProvisioningState was called
    assert.ok(updateStateStub.calledOnce);
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
    assert.strictEqual(options[0].value, "ws1");
    assert.deepStrictEqual(options[0].color, "");
    assert.strictEqual(options[0].description, "");

    // ws2 has no workspace permission
    assert.strictEqual(options[1].value, "ws2");
    assert.strictEqual(
      options[1].description,
      Fabric.insufficientWorkspacePermissions,
    );
    assert.strictEqual(options[1].icon, "Warning20Regular");
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
