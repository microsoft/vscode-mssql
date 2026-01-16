/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import * as jsonRpc from "vscode-jsonrpc/node";
import { promises as fs } from "fs";

import { expect } from "chai";

import { AzureDataStudioMigrationWebviewController } from "../../src/controllers/azureDataStudioMigrationWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { AzureAccountService } from "../../src/services/azureAccountService";
import {
    stubTelemetry,
    stubVscodeWrapper,
    stubWebviewConnectionRpc,
    stubExtensionContext,
} from "./utils";
import { Logger } from "../../src/models/logger";
import * as utils from "../../src/utils/utils";
import { AzureDataStudioMigration } from "../../src/constants/locConstants";
import {
    AzureDataStudioMigrationWebviewState,
    ImportProgressDialogProps,
    MigrationStatus,
} from "../../src/sharedInterfaces/azureDataStudioMigration";
import {
    AuthenticationType,
    IConnectionDialogProfile,
} from "../../src/sharedInterfaces/connectionDialog";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { IAccount } from "vscode-mssql";
import * as interfaces from "../../src/models/interfaces";

chai.use(sinonChai);

suite("AzureDataStudioMigrationWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let connectionStoreStub: sinon.SinonStubbedInstance<ConnectionStore>;
    let connectionConfigStub: sinon.SinonStubbedInstance<ConnectionConfig>;
    let azureAccountServiceStub: sinon.SinonStubbedInstance<AzureAccountService>;
    let controller: AzureDataStudioMigrationWebviewController;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);

        const loggerStub = sandbox.createStubInstance(Logger);
        sandbox.stub(Logger, "create").returns(loggerStub);
        sandbox.stub(utils, "getNonce").returns("nonce");

        sandbox.stub(vscode.window, "onDidChangeActiveColorTheme").callsFake(() => {
            return { dispose: sandbox.stub() } as vscode.Disposable;
        });
        sandbox.stub(vscode.window, "activeColorTheme").value({
            kind: vscode.ColorThemeKind.Dark,
        });
        sandbox.stub(vscode.workspace, "onDidChangeConfiguration").callsFake(() => {
            return { dispose: sandbox.stub() } as vscode.Disposable;
        });
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns({}),
        } as unknown as vscode.WorkspaceConfiguration);

        const rpc = stubWebviewConnectionRpc(sandbox);
        sandbox
            .stub(jsonRpc, "createMessageConnection")
            .returns(rpc.connection as unknown as jsonRpc.MessageConnection);

        mockContext = stubExtensionContext(sandbox);
        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        connectionStoreStub = sandbox.createStubInstance(ConnectionStore);
        connectionStoreStub.saveProfile.resolves();

        connectionConfigStub = sandbox.createStubInstance(ConnectionConfig);
        connectionConfigStub.addGroup.resolves();
        connectionConfigStub.getConnections.resolves([]);
        connectionConfigStub.getGroups.resolves([]);

        azureAccountServiceStub = sandbox.createStubInstance(AzureAccountService);
        azureAccountServiceStub.getAccounts.resolves([]);

        sandbox.stub(vscode.window, "showOpenDialog").resolves(undefined);

        controller = createController();
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(): AzureDataStudioMigrationWebviewController {
        return new AzureDataStudioMigrationWebviewController(
            mockContext,
            vscodeWrapperStub,
            connectionStoreStub,
            connectionConfigStub,
            azureAccountServiceStub,
        );
    }

    test("loadSettingsFromFile reads ADS config and updates state with parsed objects", async () => {
        const settingsPath = "C:\\temp\\settings.json";
        const adsSettings = JSON.stringify({
            "datasource.connectionGroups": [
                { id: "group-1", name: "Group One", parentId: "missing-parent" },
                { id: "root-group", name: "ROOT" },
            ],
            "datasource.connections": [
                {
                    id: "integrated-conn",
                    providerName: "mssql",
                    options: {
                        profileName: "Integrated Connection",
                        server: "server-one",
                        authenticationType: AuthenticationType.Integrated,
                        groupId: "group-1",
                    },
                },
                {
                    id: "existing-conn",
                    providerName: "mssql",
                    options: {
                        profileName: "Existing Connection",
                        server: "server-two",
                        authenticationType: AuthenticationType.SqlLogin,
                        user: "sqlUser",
                        groupId: "group-1",
                    },
                },
                {
                    id: "non-mssql",
                    providerName: "postgres",
                    options: {},
                },
            ],
        });

        sandbox.stub(fs, "readFile").resolves(adsSettings);
        connectionConfigStub.getConnections.resolves([
            { id: "existing-conn" } as interfaces.IConnectionProfile,
        ]);
        connectionConfigStub.getGroups.resolves([]);

        await controller["loadSettingsFromFile"](settingsPath);

        expect(
            controller.state.adsConfigPath,
            "ADS config path should reflect loaded file",
        ).to.equal(settingsPath);

        expect(
            controller.state.connectionGroups,
            "Only non-root ADS groups should be tracked",
        ).to.have.lengthOf(1);
        const [group] = controller.state.connectionGroups;
        expect(group.group.id, "Group id should match ADS payload").to.equal("group-1");
        expect(group.status, "Group import status should be ready").to.equal(MigrationStatus.Ready);
        expect(group.selected, "Ready group should be automatically selected").to.be.true;

        expect(
            controller.state.connections,
            "Non-MSSQL connections should be filtered out",
        ).to.have.lengthOf(2);
        const firstConnection = controller.state.connections[0];
        expect(firstConnection.profile.id, "Connection id should match ADS payload").to.equal(
            "integrated-conn",
        );
        expect(firstConnection.status, "Integrated connection should be ready").to.equal(
            MigrationStatus.Ready,
        );
        expect(firstConnection.selected, "Ready connection should be selected").to.be.true;

        const secondConnection = controller.state.connections[1];
        expect(secondConnection.profile.id, "Existing id should be preserved").to.equal(
            "existing-conn",
        );
        expect(
            secondConnection.status,
            "Existing connection ids should emit AlreadyImported status",
        ).to.equal(MigrationStatus.AlreadyImported);
        expect(secondConnection.selected, "Already imported connection should be unselected").to.be
            .false;
        expect(
            secondConnection.statusMessage,
            "Status message should mention the duplicate connection id",
        ).to.include("existing-conn");
    });

    test("loadSettingsFromFile preserves additional connection options", async () => {
        const settingsPath = "C:\\temp\\full-settings.json";
        const adsSettings = JSON.stringify({
            "datasource.connectionGroups": [],
            "datasource.connections": [
                {
                    id: "full-conn",
                    savePassword: true,
                    groupId: "ads-group",
                    providerName: "mssql",
                    options: {
                        connectionName: "Full Connection",
                        server: "server-full",
                        database: "full-db",
                        encrypt: "Mandatory",
                        trustServerCertificate: true,
                        commandTimeout: 45,
                        authenticationType: AuthenticationType.AzureMFA,
                        azureAccount: "acct-full",
                        azureTenantId: "tenant-full",
                    },
                },
            ],
        });

        connectionConfigStub.getConnections.resolves([]);
        connectionConfigStub.getGroups.resolves([]);
        sandbox.stub(fs, "readFile").resolves(adsSettings);

        await controller["loadSettingsFromFile"](settingsPath);

        const [connection] = controller.state.connections;
        expect(connection.profile.profileName).to.equal("Full Connection");
        expect(connection.profile.encrypt).to.equal("Mandatory");
        expect(connection.profile.commandTimeout).to.equal(45);
        expect(connection.profile.trustServerCertificate).to.be.true;
        expect(connection.profile.accountId).to.equal("acct-full");
        expect(connection.profile.tenantId).to.equal("tenant-full");
        expect(connection.profile.savePassword).to.be.true;
        expect(connection.profile.groupId).to.equal("ads-group");
    });

    test("importHelper saves selected groups and connections", async () => {
        controller["_existingGroupIds"] = new Map([["existing-group-id", "Existing Group Name"]]);
        controller["_entraAuthAccounts"] = [
            {
                key: { id: "acct-1" } as IAccount["key"],
                displayInfo: {
                    displayName: "Account One",
                    email: "user@example.com",
                } as IAccount["displayInfo"],
                properties: {
                    tenants: [{ id: "tenant-1", displayName: "Tenant One" }],
                } as IAccount["properties"],
            } as IAccount,
        ];

        const state: AzureDataStudioMigrationWebviewState = {
            adsConfigPath: "settings.json",
            connectionGroups: [
                {
                    group: {
                        id: "group-to-import",
                        name: "New Group",
                        parentId: "missing-parent",
                    },
                    status: MigrationStatus.Ready,
                    statusMessage: "",
                    selected: true,
                },
                {
                    group: {
                        id: "group-unselected",
                        name: "Skip Group",
                        parentId: "existing-group",
                    },
                    status: MigrationStatus.Ready,
                    statusMessage: "",
                    selected: false,
                },
            ],
            connections: [
                {
                    profileName: "Integrated Conn",
                    profile: {
                        id: "connection-one",
                        groupId: "group-to-import",
                        authenticationType: AuthenticationType.Integrated,
                    } as IConnectionDialogProfile,
                    status: MigrationStatus.Ready,
                    statusMessage: "",
                    selected: true,
                },
                {
                    profileName: "Azure Conn",
                    profile: {
                        id: "connection-two",
                        groupId: "missing-group",
                        authenticationType: AuthenticationType.AzureMFA,
                        accountId: "acct-1",
                        tenantId: "tenant-1",
                    } as IConnectionDialogProfile,
                    status: MigrationStatus.Ready,
                    statusMessage: "",
                    selected: true,
                },
                {
                    profileName: "Skipped Conn",
                    profile: {
                        id: "connection-three",
                        groupId: "group-to-import",
                        authenticationType: AuthenticationType.Integrated,
                    } as IConnectionDialogProfile,
                    status: MigrationStatus.Ready,
                    statusMessage: "",
                    selected: false,
                },
            ],
            dialog: undefined,
        };

        await controller["importHelper"](state);

        expect(connectionConfigStub.addGroup, "Only selected groups should be persisted").to.have
            .been.calledOnce;
        const addedGroup = connectionConfigStub.addGroup.getCall(0).args[0];
        expect(addedGroup.parentId, "Missing parents should fall back to root group").to.equal(
            ConnectionConfig.ROOT_GROUP_ID,
        );
        expect(addedGroup.configSource, "Imported groups should target global scope").to.equal(
            vscode.ConfigurationTarget.Global,
        );

        expect(connectionStoreStub.saveProfile, "Only selected connections should be added").to.have
            .been.calledTwice;
        const savedProfiles = connectionStoreStub.saveProfile
            .getCalls()
            .map((call) => call.args[0] as IConnectionDialogProfile);

        const expectedSave = savedProfiles.find((profile) => profile.id === "connection-one");
        expect(expectedSave?.groupId, "Integrated connection should keep selected group").to.equal(
            "group-to-import",
        );
        expect(
            (expectedSave as interfaces.IConnectionProfile)?.configSource,
            "Imported connection should target global scope",
        ).to.equal(vscode.ConfigurationTarget.Global);

        const azureSave = savedProfiles.find(
            (profile) => profile.authenticationType === AuthenticationType.AzureMFA,
        );
        expect(
            azureSave?.groupId,
            "Connections referencing invalid groups should default to root",
        ).to.equal(ConnectionConfig.ROOT_GROUP_ID);

        const dialog = controller.state.dialog as ImportProgressDialogProps;

        expect(dialog.type, "Import helper should surface progress dialog").to.equal(
            "importProgress",
        );
        expect(dialog.status.status, "Successful import should flip the dialog to loaded").to.equal(
            ApiStatus.Loaded,
        );
        expect(
            dialog.status.message,
            "Success dialog should use localized success message",
        ).to.equal(AzureDataStudioMigration.importProgressSuccessMessage);
    });

    test("updateConnectionStatus reflects sql password and Entra account requirements", () => {
        controller["_existingConnectionIds"] = new Map([
            ["existing-conn-id", "Existing Connection Name"],
        ]);
        controller["_entraAuthAccounts"] = [
            {
                key: { id: "acct-1" } as IAccount["key"],
                displayInfo: {
                    displayName: "Account",
                    email: "account@example.com",
                } as IAccount["displayInfo"],
                properties: {
                    tenants: [],
                } as IAccount["properties"],
            } as IAccount,
        ];

        const alreadyImported = controller["updateConnectionStatus"]({
            profileName: "Existing",
            profile: {
                id: "existing-conn-id",
                authenticationType: AuthenticationType.Integrated,
            } as IConnectionDialogProfile,
            status: MigrationStatus.Ready,
            statusMessage: "",
            selected: true,
        });
        expect(
            alreadyImported.status,
            "Connections with ids already persisted should be marked already imported",
        ).to.equal(MigrationStatus.AlreadyImported);
        expect(alreadyImported.selected, "Already imported connection should be deselected").to.be
            .false;

        const missingPassword = controller["updateConnectionStatus"]({
            profileName: "Sql Login",
            profile: {
                id: "sql-conn",
                authenticationType: AuthenticationType.SqlLogin,
                user: "sqlUser",
                password: "",
            } as IConnectionDialogProfile,
            status: MigrationStatus.Ready,
            statusMessage: "",
            selected: true,
        });
        expect(
            missingPassword.status,
            "SQL login without password should require user attention",
        ).to.equal(MigrationStatus.NeedsAttention);
        expect(missingPassword.selected, "Connections needing attention should be deselected").to.be
            .false;
        expect(
            missingPassword.statusMessage,
            "Status message should call out the missing SQL password",
        ).to.equal(AzureDataStudioMigration.connectionIssueMissingSqlPassword("sqlUser"));

        const azureReady = controller["updateConnectionStatus"]({
            profileName: "Azure",
            profile: {
                id: "azure-conn",
                authenticationType: AuthenticationType.AzureMFA,
                accountId: "acct-1",
                user: "azureUser",
            } as IConnectionDialogProfile,
            status: MigrationStatus.NeedsAttention,
            statusMessage: "old message",
            selected: false,
        });
        expect(azureReady.status, "Azure connection with valid account should be ready").to.equal(
            MigrationStatus.Ready,
        );
        expect(azureReady.selected, "Ready Azure connection should auto-select").to.be.true;
        expect(
            azureReady.statusMessage,
            "Ready Azure connection should surface the ready message",
        ).to.equal(AzureDataStudioMigration.ImportStatusReady);
    });
});
