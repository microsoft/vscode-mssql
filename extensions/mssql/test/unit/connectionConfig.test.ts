/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { InstantiationServiceBuilder, ServiceDescriptor } from "extension-toolkit/base";
import { ConnectionConfig, IConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { IConnectionGroup, IConnectionProfile } from "../../src/models/interfaces";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { deepClone } from "../../src/models/utils";
import {
    createStubLogger,
    initializeIconUtils,
    stubExtensionContext,
    stubMessageBoxes,
} from "./utils";
import { Deferred } from "../../src/protocol";
import { ConnectionStore } from "../../src/models/connectionStore";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { ExtensionContextService } from "extension-toolkit/vscode";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { ObjectExplorerProvider } from "../../src/objectExplorer/objectExplorerProvider";

const { expect } = chai;

chai.use(sinonChai);

suite("ConnectionConfig Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let messageBoxes: ReturnType<typeof stubMessageBoxes>;
    let showWarningStub: sinon.SinonStub;
    let showQuickPickStub: sinon.SinonStub;
    let updateConfigurationStub: sinon.SinonStub;
    let rootConfigurationGetStub: sinon.SinonStub;
    let mockWorkspaceFolders: vscode.WorkspaceFolder[];
    let mockWorkspaceFile: vscode.Uri | undefined;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    let mockGlobalConfigData: Map<string, any> = new Map();
    let mockWorkspaceConfigData: Map<string, any> = new Map();
    let mockWorkspaceFolderConfigData: Map<string, Map<string, any>> = new Map();
    /* eslint-enable @typescript-eslint/no-explicit-any */

    setup(() => {
        sandbox = sinon.createSandbox();

        mockGlobalConfigData = new Map();
        mockWorkspaceConfigData = new Map();
        mockWorkspaceFolderConfigData = new Map();
        mockWorkspaceFolders = [];
        mockWorkspaceFile = undefined;
        messageBoxes = stubMessageBoxes(sandbox);
        showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
        rootConfigurationGetStub = sandbox.stub();
        updateConfigurationStub = sandbox.stub().resolves();

        sandbox.stub(vscode.workspace, "workspaceFolders").get(() => mockWorkspaceFolders);
        sandbox.stub(vscode.workspace, "workspaceFile").get(() => mockWorkspaceFile);
        sandbox
            .stub(vscode.workspace, "getConfiguration")
            .callsFake((section?: string, resource?: vscode.Uri) => {
                if (section === Constants.extensionName) {
                    const workspaceFolderStore = resource
                        ? mockWorkspaceFolderConfigData.get(resource.toString())
                        : undefined;
                    return {
                        get: (setting: string) => mockGlobalConfigData.get(setting),
                        inspect: (setting: string) =>
                            deepClone({
                                globalValue: mockGlobalConfigData.get(setting) || [],
                                workspaceValue: mockWorkspaceConfigData.get(setting) || [],
                                workspaceFolderValue: workspaceFolderStore?.get(setting) || [],
                            }),
                        update: async (
                            key: string,
                            value: unknown,
                            target: ConfigurationTarget,
                        ) => {
                            await updateConfigurationStub(key, value, target, resource?.toString());
                            const targetStore =
                                target === ConfigurationTarget.WorkspaceFolder
                                    ? workspaceFolderStore
                                    : target === ConfigurationTarget.Workspace
                                      ? mockWorkspaceConfigData
                                      : mockGlobalConfigData;
                            targetStore?.set(key, deepClone(value));
                        },
                    } as unknown as vscode.WorkspaceConfiguration;
                }
                return {
                    get: rootConfigurationGetStub,
                } as unknown as vscode.WorkspaceConfiguration;
            });

        sandbox.stub(vscode.window, "activeTextEditor").value(undefined);

        messageBoxes.showErrorMessage.resolves(undefined);
        showWarningStub = messageBoxes.showWarningMessage.resolves(undefined);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Initialization", () => {
        test("Initialization creates ROOT group when it doesn't exist", async () => {
            const config = new ConnectionConfig();
            await config.initialized;

            const savedGroups = mockGlobalConfigData.get(
                Constants.connectionGroupsArrayName,
            ) as IConnectionGroup[];

            expect(savedGroups).to.have.lengthOf(1);
            expect(savedGroups[0].name).to.equal("ROOT");
            expect(savedGroups[0].id).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        });

        test("Initialization migrates legacy ROOT ID and reassigns children", async () => {
            const legacyRootId = "legacy-root-id";
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: legacyRootId },
                { name: "Child Group", id: "child-group", parentId: legacyRootId },
            ]);

            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    id: "conn-id",
                    groupId: legacyRootId,
                    server: "server",
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile,
            ]);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;

            const savedGroups = mockGlobalConfigData.get(
                Constants.connectionGroupsArrayName,
            ) as IConnectionGroup[];
            const rootGroup = savedGroups.find((g) => g.name === "ROOT");
            const childGroup = savedGroups.find((g) => g.name === "Child Group");

            expect(rootGroup?.id).to.equal(ConnectionConfig.ROOT_GROUP_ID);
            expect(savedGroups.find((g) => g.id === legacyRootId)).to.be.undefined;
            expect(childGroup?.parentId).to.equal(ConnectionConfig.ROOT_GROUP_ID);

            const savedConnections = mockGlobalConfigData.get(
                Constants.connectionsArrayName,
            ) as IConnectionProfile[];
            expect(savedConnections[0].groupId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        });

        test("Initialization batches all group and connection repairs into one write each", async () => {
            const legacyRootId = "legacy-root-id";
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: legacyRootId },
                { name: "Child Group", parentId: legacyRootId },
            ]);
            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    groupId: legacyRootId,
                    server: "server",
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                    connectionString: "Server=server",
                },
            ]);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;

            const groupWrites = updateConfigurationStub
                .getCalls()
                .filter((call) => call.args[0] === Constants.connectionGroupsArrayName);
            const connectionWrites = updateConfigurationStub
                .getCalls()
                .filter((call) => call.args[0] === Constants.connectionsArrayName);
            expect(groupWrites).to.have.lengthOf(1);
            expect(connectionWrites).to.have.lengthOf(1);

            const savedGroups = mockGlobalConfigData.get(
                Constants.connectionGroupsArrayName,
            ) as IConnectionGroup[];
            expect(savedGroups.find((group) => group.name === "Child Group")).to.include({
                parentId: ConnectionConfig.ROOT_GROUP_ID,
            });
            expect(savedGroups.find((group) => group.name === "Child Group")?.id).to.be.a("string")
                .and.not.empty;

            const savedConnections = mockGlobalConfigData.get(
                Constants.connectionsArrayName,
            ) as IConnectionProfile[];
            expect(savedConnections[0]).to.include({
                groupId: ConnectionConfig.ROOT_GROUP_ID,
            });
            expect(savedConnections[0].id).to.be.a("string").and.not.empty;
            expect(savedConnections[0]).not.to.have.property("connectionString");
        });

        test("Initialization adds IDs to groups without IDs", async () => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
                { name: "Group without ID" } as IConnectionGroup, // Missing ID
            ]);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;

            const savedGroups = mockGlobalConfigData.get(
                Constants.connectionGroupsArrayName,
            ) as IConnectionGroup[];
            expect(savedGroups).to.have.lengthOf(2);

            const nonRootGroup = savedGroups.find((g) => g.name === "Group without ID");
            expect(nonRootGroup).to.not.be.undefined;
            expect(nonRootGroup?.id).to.not.be.undefined;
            expect(nonRootGroup?.parentId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        });

        test("Initialization adds missing IDs to connection profiles", async () => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
            ]);

            // Start with a profile missing both ID and groupId
            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    server: "test-server",
                    database: "test-db",
                    authenticationType: "SqlLogin",
                    user: "test-user",
                    password: "",
                    profileName: "Test Profile",
                    savePassword: false,
                    emptyPasswordInput: false,
                } as IConnectionProfile,
            ]);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;

            const savedProfiles = mockGlobalConfigData.get(
                Constants.connectionsArrayName,
            ) as IConnectionProfile[];
            expect(savedProfiles).to.have.lengthOf(1);
            expect(savedProfiles[0].id).to.not.be.undefined;
            expect(savedProfiles[0].groupId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        });

        test("Initialization removes and saves legacy connection string properties", async () => {
            const mockLogger = createStubLogger(sandbox);
            const connectionString = "Server=legacy-server;Integrated Security=true";
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
            ]);
            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    id: "legacy-profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "explicit-server",
                    connectionString,
                    profileName: "Legacy Profile",
                },
                {
                    id: "valid-profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "valid-server",
                    authenticationType: "Integrated",
                    profileName: "Valid Profile",
                },
            ]);

            const connConfig = new ConnectionConfig(mockLogger);
            await connConfig.initialized;

            const savedProfiles = mockGlobalConfigData.get(
                Constants.connectionsArrayName,
            ) as IConnectionProfile[];
            expect(savedProfiles.map((profile) => profile.id)).to.deep.equal([
                "legacy-profile-id",
                "valid-profile-id",
            ]);
            expect(savedProfiles[0]).to.include({ server: "explicit-server" });
            expect(savedProfiles[0]).not.to.have.property("connectionString");

            const expectedMessage = LocalizedConstants.Connection.connectionStringPropertyRemoved(
                "Legacy Profile",
                connectionString,
            );
            expect(mockLogger.warn).to.have.been.calledOnceWith(expectedMessage);
            expect(messageBoxes.showInformationMessage).to.have.been.calledOnceWith(
                expectedMessage,
            );
        });

        test("Initialization deletes connection string profiles without a server", async () => {
            const mockLogger = createStubLogger(sandbox);
            const connectionString = "Server=legacy-server;Integrated Security=true";
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
            ]);
            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    id: "valid-profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "valid-server",
                    authenticationType: "Integrated",
                    profileName: "Valid Profile",
                },
            ]);
            mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                {
                    id: "legacy-profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    connectionString,
                    profileName: "Legacy Profile",
                },
            ]);

            const connConfig = new ConnectionConfig(mockLogger);
            await connConfig.initialized;

            const savedProfiles = mockGlobalConfigData.get(
                Constants.connectionsArrayName,
            ) as IConnectionProfile[];
            expect(savedProfiles.map((profile) => profile.id)).to.deep.equal(["valid-profile-id"]);
            expect(mockWorkspaceConfigData.get(Constants.connectionsArrayName)).to.deep.equal([]);

            const expectedMessage =
                LocalizedConstants.Connection.connectionDeletedAfterConnectionStringRemoval(
                    "Legacy Profile",
                    connectionString,
                );
            expect(mockLogger.warn).to.have.been.calledOnceWith(expectedMessage);
            expect(messageBoxes.showInformationMessage).to.have.been.calledOnceWith(
                expectedMessage,
            );
        });

        test("Initialization completes when settings can't be written", async () => {
            updateConfigurationStub.rejects(new Error("Unable to write settings"));
            const logger = createStubLogger(sandbox);

            const connConfig = new ConnectionConfig(logger);
            await connConfig.initialized;

            expect(logger.error).to.have.been.calledWith(
                sinon.match("Failed to update connection settings during initialization:"),
            );
        });

        test("Initialization keeps the legacy root when connection repairs can't be written", async () => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: "legacy-root-id" },
                { name: "Child Group", parentId: "legacy-root-id" },
            ]);
            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    server: "test-server",
                    groupId: "legacy-root-id",
                    authenticationType: "Integrated",
                },
            ]);
            updateConfigurationStub
                .withArgs(Constants.connectionsArrayName)
                .rejects(new Error("Unable to write repaired connections"));
            const logger = createStubLogger(sandbox);

            const connConfig = new ConnectionConfig(logger);
            await connConfig.initialized;

            const savedGroups = mockGlobalConfigData.get(
                Constants.connectionGroupsArrayName,
            ) as IConnectionGroup[];
            expect(savedGroups.find((group) => group.name === "Child Group")).to.include({
                parentId: "legacy-root-id",
            });
            expect(savedGroups.find((group) => group.name === "ROOT")?.id).to.equal(
                "legacy-root-id",
            );
            expect(logger.error).to.have.been.calledWith(
                sinon.match("Unable to write repaired connections"),
            );
        });

        for (const setting of [
            Constants.connectionsArrayName,
            Constants.connectionGroupsArrayName,
        ]) {
            for (const target of [
                ConfigurationTarget.Global,
                ConfigurationTarget.Workspace,
                ConfigurationTarget.WorkspaceFolder,
            ]) {
                test(`Initialization recovers legacy references after a ${setting} write fails in ${ConfigurationTarget[target]}`, async () => {
                    const folder = addMockWorkspaceFolder("migration-folder", 0);
                    const legacyRootId = "legacy-root-id";
                    mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                        { name: "ROOT", id: legacyRootId },
                        {
                            ...createStoredGroup("global-child", "Global Child"),
                            parentId: legacyRootId,
                        },
                    ]);
                    mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                        {
                            ...createStoredGroup("workspace-child", "Workspace Child"),
                            parentId: legacyRootId,
                        },
                    ]);
                    setWorkspaceFolderData(folder.uri, Constants.connectionGroupsArrayName, [
                        {
                            ...createStoredGroup("folder-child", "Folder Child"),
                            parentId: legacyRootId,
                        },
                        { ...createStoredGroup("nested", "Nested"), parentId: "folder-child" },
                    ]);
                    mockGlobalConfigData.set(Constants.connectionsArrayName, [
                        createStoredProfile("global-profile", legacyRootId),
                        createStoredProfile("child-profile", "global-child"),
                    ]);
                    mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                        createStoredProfile("workspace-profile", legacyRootId),
                    ]);
                    setWorkspaceFolderData(folder.uri, Constants.connectionsArrayName, [
                        createStoredProfile("folder-profile", legacyRootId),
                        createStoredProfile("nested-profile", "nested"),
                    ]);
                    updateConfigurationStub
                        .withArgs(setting, sinon.match.any, target)
                        .rejects(new Error("Settings write interrupted"));
                    const logger = createStubLogger(sandbox);
                    const first = new ConnectionConfig(logger);
                    await first.initialized;

                    expect(logger.error).to.have.been.calledWith(
                        sinon.match("Settings write interrupted"),
                    );
                    expect(
                        getStoredGroups().find((group: IConnectionGroup) => group.name === "ROOT")
                            ?.id,
                    ).to.equal(legacyRootId);
                    expect(
                        [
                            ...getStoredConnections(),
                            ...getStoredConnections(ConfigurationTarget.Workspace),
                            ...getWorkspaceFolderData<IConnectionProfile[]>(
                                folder.uri,
                                Constants.connectionsArrayName,
                            ),
                        ].map((profile) => profile.id),
                    ).to.have.members([
                        "global-profile",
                        "child-profile",
                        "workspace-profile",
                        "folder-profile",
                        "nested-profile",
                    ]);
                    updateConfigurationStub.resetBehavior();
                    updateConfigurationStub.resolves();

                    const restarted = new ConnectionConfig();
                    await restarted.initialized;

                    expect(
                        (await restarted.getConnections()).map((profile) => profile.id),
                    ).to.have.members([
                        "global-profile",
                        "child-profile",
                        "workspace-profile",
                        "folder-profile",
                        "nested-profile",
                    ]);
                    for (const id of ["global-profile", "workspace-profile", "folder-profile"]) {
                        expect(await restarted.getConnectionById(id)).to.have.property(
                            "groupId",
                            ConnectionConfig.ROOT_GROUP_ID,
                        );
                    }
                    for (const id of ["global-child", "workspace-child", "folder-child"]) {
                        expect(restarted.getGroupById(id)?.parentId).to.equal(
                            ConnectionConfig.ROOT_GROUP_ID,
                        );
                    }
                    expect(restarted.getGroupById("nested")?.parentId).to.equal("folder-child");
                });
            }
        }

        test("Initialization doesn't make changes when all IDs are present", async () => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
            ]);

            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    id: "profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "test-server",
                    database: "test-db",
                    authenticationType: "SqlLogin",
                    user: "test-user",
                    password: "",
                    profileName: "Test Profile",
                    savePassword: false,
                    emptyPasswordInput: false,
                } as IConnectionProfile,
            ]);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;

            // Verify setConfiguration was not called since no changes needed
            expect(updateConfigurationStub).to.not.have.been.called;
        });
    });

    function getStoredConnections(
        target: ConfigurationTarget = ConfigurationTarget.Global,
    ): IConnectionProfile[] {
        const store =
            target === ConfigurationTarget.Workspace
                ? mockWorkspaceConfigData
                : mockGlobalConfigData;
        return deepClone(store.get(Constants.connectionsArrayName) || []);
    }

    function getStoredGroups(target: ConfigurationTarget = ConfigurationTarget.Global) {
        const store =
            target === ConfigurationTarget.Workspace
                ? mockWorkspaceConfigData
                : mockGlobalConfigData;
        return deepClone(store.get(Constants.connectionGroupsArrayName) || []);
    }

    function addMockWorkspaceFolder(name: string, index: number): vscode.WorkspaceFolder {
        const workspaceFolder = {
            name,
            index,
            uri: vscode.Uri.file(`/workspace/${name}`),
        };
        mockWorkspaceFolders.push(workspaceFolder);
        mockWorkspaceFile ??= vscode.Uri.file("/workspace/test.code-workspace");
        mockWorkspaceFolderConfigData.set(workspaceFolder.uri.toString(), new Map());
        return workspaceFolder;
    }

    function setWorkspaceFolderData(uri: vscode.Uri, setting: string, value: unknown[]): void {
        mockWorkspaceFolderConfigData.get(uri.toString())?.set(setting, deepClone(value));
    }

    function getWorkspaceFolderData<T>(uri: vscode.Uri, setting: string): T {
        return deepClone(mockWorkspaceFolderConfigData.get(uri.toString())?.get(setting));
    }

    function createStoredProfile(id: string, groupId: string): IConnectionProfile {
        return {
            id,
            groupId,
            server: id,
            authenticationType: "Integrated",
            profileName: id,
        } as IConnectionProfile;
    }

    function createStoredGroup(id: string, name: string): IConnectionGroup {
        return {
            id,
            name,
            parentId: ConnectionConfig.ROOT_GROUP_ID,
        } as IConnectionGroup;
    }

    suite("Functions", () => {
        setup(() => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
            ]);
        });

        for (const authenticationType of ["SqlLogin", "AzureMFA"]) {
            test(`updateProfile returns concurrent non-secret edits and deletions to Connect while preserving ${authenticationType} credentials`, async () => {
                const config = new ConnectionConfig();
                await config.initialized;
                await config.addGroup({
                    ...createStoredGroup("parent", "Workspace parent"),
                    configSource: ConfigurationTarget.Workspace,
                });
                const credentials = sandbox.createStubInstance(CredentialStore);
                credentials.saveCredential.resolves(true);
                credentials.deleteCredential.resolves();
                const context = stubExtensionContext(sandbox);
                (context.globalState.get as sinon.SinonStub).returns([]);
                (context.globalState.update as sinon.SinonStub).resolves();
                const store = new ConnectionStore(
                    new ExtensionContextService(context),
                    credentials,
                    config,
                    createStubLogger(sandbox),
                );
                const original: IConnectionProfile = {
                    ...createStoredProfile("editing", ConnectionConfig.ROOT_GROUP_ID),
                    authenticationType,
                    server: "original-server",
                    database: "original-database",
                    containerName: "old-container",
                    password: authenticationType === "SqlLogin" ? "session-password" : "",
                    azureAccountToken: authenticationType === "AzureMFA" ? "session-token" : "",
                    savePassword: true,
                };
                await store.saveProfile(original);
                const edited = { ...original, groupId: "parent" };
                const opened = new Deferred<void>();
                const choice = new Deferred<string>();
                messageBoxes.showInformationMessage.callsFake(() => {
                    opened.resolve();
                    return choice.promise;
                });
                const pending = store.updateProfile(edited, original);
                await opened.promise;
                const concurrent = (await config.getConnectionById(original.id))!;
                concurrent.server = "latest-server";
                concurrent.database = "latest-database";
                delete concurrent.containerName;
                await config.updateConnection(concurrent);
                choice.resolve(
                    LocalizedConstants.ConnectionConfig.updateSaveLocation(
                        LocalizedConstants.ConnectionConfig.workspaceConfig,
                    ),
                );

                expect(await pending).to.be.true;
                const saved = await config.getConnectionById(original.id);
                expect(saved).to.include({ server: "latest-server", database: "latest-database" });
                expect(saved).not.to.have.property("containerName");
                expect(edited).to.include({
                    server: saved.server,
                    database: saved.database,
                    configSource: ConfigurationTarget.Workspace,
                    password: original.password,
                    azureAccountToken: original.azureAccountToken,
                });
                expect(edited).not.to.have.property("containerName");
                expect(
                    saved[authenticationType === "SqlLogin" ? "password" : "azureAccountToken"],
                ).to.equal("");
                if (authenticationType === "SqlLogin") {
                    expect(credentials.saveCredential).to.have.been.calledWith(
                        ConnectionStore.formatCredentialIdForCred(edited),
                        "session-password",
                    );
                }
            });
        }

        for (const preserveProfiles of [true, false]) {
            test(`real node removal ${preserveProfiles ? "preserves edited" : "deletes saved"} profiles and credentials`, async () => {
                initializeIconUtils();
                const config = new ConnectionConfig();
                await config.initialized;
                const credentialStore = sandbox.createStubInstance(CredentialStore);
                credentialStore.saveCredential.resolves(true);
                credentialStore.deleteCredential.resolves();
                const context = stubExtensionContext(sandbox);
                (context.globalState.get as sinon.SinonStub).returns([]);
                (context.globalState.update as sinon.SinonStub).resolves();
                const store = new ConnectionStore(
                    new ExtensionContextService(context),
                    credentialStore,
                    config,
                    createStubLogger(sandbox),
                );
                await store.initialized;
                const profile: IConnectionProfile = {
                    ...createStoredProfile("edited", ConnectionConfig.ROOT_GROUP_ID),
                    authenticationType: "SqlLogin",
                    user: "test-user",
                    password: "saved-password",
                    savePassword: true,
                };
                await store.saveProfile(profile);
                const manager = sandbox.createStubInstance(ConnectionManager);
                sandbox.stub(manager, "connectionStore").get(() => store);
                manager.client = sandbox.createStubInstance(SqlToolsServiceClient);
                const provider = new ObjectExplorerProvider(manager);
                await provider.objectExplorerService.initialized;
                const updated = { ...profile, profileName: "Edited profile" };
                await store.updateProfile(updated, profile);
                credentialStore.deleteCredential.resetHistory();

                await provider.removeConnectionNodes([profile], { preserveProfiles });

                expect(provider.objectExplorerService.getConnectionNodeFromProfile(profile)).to.be
                    .undefined;
                expect(manager.disconnect).to.have.been.called;
                if (preserveProfiles) {
                    expect(await config.getConnectionById(profile.id)).to.include({
                        profileName: "Edited profile",
                    });
                    expect(credentialStore.deleteCredential).not.to.have.been.called;
                } else {
                    expect(await config.getConnectionById(profile.id)).to.be.undefined;
                    expect(credentialStore.deleteCredential).to.have.been.calledWith(
                        ConnectionStore.formatCredentialIdForCred(profile),
                    );
                }
                provider["_onDidChangeTreeData"].dispose();
            });
        }

        for (const kind of ["connection", "group"] as const) {
            suite(`${kind} mutation safety`, () => {
                let config: ConnectionConfig;
                const setting =
                    kind === "connection"
                        ? Constants.connectionsArrayName
                        : Constants.connectionGroupsArrayName;
                const rootId = ConnectionConfig.ROOT_GROUP_ID;
                const makeItem = (id: string, parentId = rootId) =>
                    kind === "connection"
                        ? createStoredProfile(id, parentId)
                        : { ...createStoredGroup(id, id), parentId };
                const update = (id: string, parentId = rootId, name = id) =>
                    kind === "connection"
                        ? config.updateConnection({
                              ...createStoredProfile(id, parentId),
                              profileName: name,
                          })
                        : config.updateGroup({
                              ...createStoredGroup(id, name),
                              parentId,
                          });
                const add = (id: string) =>
                    kind === "connection"
                        ? config.addConnection(createStoredProfile(id, rootId))
                        : config.addGroup(createStoredGroup(id, id));
                const remove = (id: string) =>
                    kind === "connection"
                        ? config.removeConnection(createStoredProfile(id, rootId))
                        : config.removeGroup(id);
                const stored = (target = ConfigurationTarget.Global) =>
                    kind === "connection"
                        ? getStoredConnections(target)
                        : (getStoredGroups(target) as IConnectionGroup[]);
                const moveChoice = (
                    location = LocalizedConstants.ConnectionConfig.workspaceConfig,
                ) => LocalizedConstants.ConnectionConfig.updateSaveLocation(location);

                async function expectFailure(operation: Promise<unknown>, message: string) {
                    let error: Error | undefined;
                    try {
                        await operation;
                    } catch (caught) {
                        error = caught as Error;
                    }
                    expect(error?.message).to.contain(message);
                }

                function deferPrompt() {
                    const opened = new Deferred<void>();
                    const choice = new Deferred<string>();
                    messageBoxes.showInformationMessage.callsFake(() => {
                        opened.resolve();
                        return choice.promise;
                    });
                    return { opened: opened.promise, choice };
                }

                setup(async () => {
                    const existing = mockGlobalConfigData.get(setting) ?? [];
                    mockGlobalConfigData.set(setting, [
                        ...existing,
                        makeItem("target"),
                        makeItem("unrelated"),
                        makeItem("deleted"),
                    ]);
                    mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                        createStoredGroup("parent", "Workspace parent"),
                    ]);
                    config = new ConnectionConfig();
                    await config.initialized;
                    updateConfigurationStub.resetHistory();
                    messageBoxes.showInformationMessage.resolves(moveChoice());
                });

                test("removes optional fields omitted by an edited replacement", async () => {
                    const optionalKey = kind === "connection" ? "user" : "description";
                    mockGlobalConfigData.set(
                        setting,
                        stored().map((item) =>
                            item.id === "target" ? { ...item, [optionalKey]: "Clear me" } : item,
                        ),
                    );

                    expect(await update("target")).to.be.true;

                    expect(stored().find((item) => item.id === "target")).not.to.have.property(
                        optionalKey,
                    );
                });

                test("applies intentional field deletions while retaining concurrent untouched fields", async () => {
                    const optionalKey = kind === "connection" ? "user" : "description";
                    const nameKey = kind === "connection" ? "profileName" : "name";
                    mockGlobalConfigData.set(
                        setting,
                        stored().map((item) =>
                            item.id === "target" ? { ...item, [optionalKey]: "Clear me" } : item,
                        ),
                    );
                    const prompt = deferPrompt();
                    const pending = update("target", "parent");
                    await prompt.opened;
                    mockGlobalConfigData.set(
                        setting,
                        stored().map((item) =>
                            item.id === "target" ? { ...item, [nameKey]: "External edit" } : item,
                        ),
                    );
                    prompt.choice.resolve(moveChoice());

                    expect(await pending).to.be.true;

                    expect(
                        stored(ConfigurationTarget.Workspace).find((item) => item.id === "target"),
                    )
                        .to.have.property(nameKey, "External edit")
                        .and.not.to.have.property(optionalKey);
                });

                test("returns the final merged fields and deletions to the update caller", async () => {
                    const optionalKey = kind === "connection" ? "containerName" : "description";
                    const nameKey = kind === "connection" ? "profileName" : "name";
                    mockGlobalConfigData.set(
                        setting,
                        stored().map((item) =>
                            item.id === "target" ? { ...item, [optionalKey]: "Original" } : item,
                        ),
                    );
                    const prompt = deferPrompt();
                    const item = { ...makeItem("target", "parent"), [optionalKey]: "Original" };
                    const pending =
                        kind === "connection"
                            ? config.updateConnection(item as IConnectionProfile)
                            : config.updateGroup(item as IConnectionGroup);
                    await prompt.opened;
                    mockGlobalConfigData.set(
                        setting,
                        stored().map((entry) => {
                            if (entry.id !== "target") {
                                return entry;
                            }
                            const latest = { ...entry, [nameKey]: "Latest name" };
                            delete latest[optionalKey];
                            return latest;
                        }),
                    );
                    prompt.choice.resolve(moveChoice());

                    expect(await pending).to.be.true;
                    expect(item).to.have.property(nameKey, "Latest name");
                    expect(item).not.to.have.property(optionalKey);
                });

                for (const change of ["add", "delete", "update", "same-target update"] as const) {
                    test(`reloads settings after a modal while preserving a concurrent ${change}`, async () => {
                        const prompt = deferPrompt();
                        const pending = update("target", "parent");
                        await prompt.opened;

                        if (change === "add") {
                            await add("new-item");
                        } else if (change === "delete") {
                            await remove("deleted");
                        } else {
                            await update(
                                change === "same-target update" ? "target" : "unrelated",
                                rootId,
                                "Concurrent edit",
                            );
                        }
                        prompt.choice.resolve(moveChoice());
                        expect(await pending).to.be.true;

                        const all = [...stored(), ...stored(ConfigurationTarget.Workspace)];
                        const ids = all.map((item) => item.id);
                        if (change === "add") {
                            expect(ids).to.include("new-item");
                        } else if (change === "delete") {
                            expect(ids).not.to.include("deleted");
                        } else {
                            expect(
                                all.find(
                                    (item) =>
                                        item.id ===
                                        (change === "same-target update" ? "target" : "unrelated"),
                                ),
                            ).to.have.property(
                                kind === "connection" ? "profileName" : "name",
                                "Concurrent edit",
                            );
                        }
                    });
                }

                for (const deleted of ["target", "parent"]) {
                    test(`rejects ${deleted} deletion while a modal is open`, async () => {
                        const prompt = deferPrompt();
                        const pending = update("target", "parent");
                        await prompt.opened;
                        if (deleted === "target") {
                            await remove("target");
                        } else {
                            await config.removeGroup("parent");
                        }
                        prompt.choice.resolve(moveChoice());

                        await expectFailure(
                            pending,
                            deleted === "target"
                                ? LocalizedConstants.ConnectionConfig.itemNotFound("target")
                                : LocalizedConstants.ConnectionConfig.parentGroupNotFound("parent"),
                        );
                        expect(
                            stored(ConfigurationTarget.Workspace).map((item) => item.id),
                        ).not.to.include("target");
                        expect(stored().map((item) => item.id)).to.include("unrelated");
                    });
                }

                test("rejects a newly missing parent ancestor after modal input", async () => {
                    const prompt = deferPrompt();
                    const pending = update("target", "parent");
                    await prompt.opened;
                    mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                        { ...createStoredGroup("parent", "Workspace parent"), parentId: "missing" },
                    ]);
                    prompt.choice.resolve(moveChoice());

                    await expectFailure(
                        pending,
                        LocalizedConstants.ConnectionConfig.parentGroupNotFound("missing"),
                    );
                    expect(stored().map((item) => item.id)).to.include("target");
                });

                test("reloads external-window settings after modal input", async () => {
                    const prompt = deferPrompt();
                    const pending = update("target", "parent");
                    await prompt.opened;
                    mockGlobalConfigData.set(setting, [
                        ...stored().filter((item) => item.id !== "deleted"),
                        makeItem("external-item"),
                    ]);
                    prompt.choice.resolve(moveChoice());

                    expect(await pending).to.be.true;
                    expect(stored().map((item) => item.id))
                        .to.include("external-item")
                        .and.not.to.include("deleted");
                });

                test("reconfirms when the parent moves to another folder during modal input", async () => {
                    const folder = addMockWorkspaceFolder("moved-parent", 0);
                    const prompt = deferPrompt();
                    const pending = update("target", "parent");
                    await prompt.opened;
                    mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, []);
                    setWorkspaceFolderData(folder.uri, Constants.connectionGroupsArrayName, [
                        createStoredGroup("parent", "Folder parent"),
                    ]);
                    messageBoxes.showInformationMessage
                        .onSecondCall()
                        .resolves(
                            moveChoice(
                                LocalizedConstants.ConnectionConfig.workspaceFolderConfig(
                                    folder.name,
                                ),
                            ),
                        );
                    prompt.choice.resolve(moveChoice());

                    expect(await pending).to.be.true;
                    expect(
                        getWorkspaceFolderData<Array<{ id: string }>>(folder.uri, setting).map(
                            (item) => item.id,
                        ),
                    ).to.include("target");
                    expect(
                        stored(ConfigurationTarget.Workspace).map((item) => item.id),
                    ).not.to.include("target");
                    expect(messageBoxes.showInformationMessage).to.have.been.calledWith(
                        sinon.match(folder.name),
                        { modal: true },
                        moveChoice(
                            LocalizedConstants.ConnectionConfig.workspaceFolderConfig(folder.name),
                        ),
                        sinon.match.string,
                    );
                });

                if (kind === "group") {
                    test("rejects a hierarchy made cyclic by another window during modal input", async () => {
                        const prompt = deferPrompt();
                        const pending = update("target", "parent");
                        await prompt.opened;
                        mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                            { ...createStoredGroup("parent", "Parent"), parentId: "target" },
                        ]);
                        prompt.choice.resolve(moveChoice());

                        await expectFailure(
                            pending,
                            LocalizedConstants.ConnectionConfig.groupMoveCreatesCycle(
                                "target",
                                "Parent",
                            ),
                        );
                        expect(config.getGroupById("target")?.parentId).to.equal(rootId);
                    });
                }

                test("serializes overlapping additions without losing either saved item", async () => {
                    const writing = new Deferred<void>();
                    const release = new Deferred<void>();
                    updateConfigurationStub.onFirstCall().callsFake(async () => {
                        writing.resolve();
                        await release.promise;
                    });
                    const first = add("first");
                    await writing.promise;
                    const second = add("second");
                    release.resolve();
                    await Promise.all([first, second]);

                    expect(stored().map((item) => item.id)).to.include.members(["first", "second"]);
                });

                test("serializes overlapping updates and removals against the latest settings", async () => {
                    const writing = new Deferred<void>();
                    const release = new Deferred<void>();
                    updateConfigurationStub.onFirstCall().callsFake(async () => {
                        writing.resolve();
                        await release.promise;
                    });
                    const first = update("unrelated", rootId, "Updated");
                    await writing.promise;
                    const second = remove("deleted");
                    release.resolve();
                    await Promise.all([first, second]);

                    expect(stored().map((item) => item.id)).not.to.include("deleted");
                    expect(stored().find((item) => item.id === "unrelated")).to.have.property(
                        kind === "connection" ? "profileName" : "name",
                        "Updated",
                    );
                });

                test("allows later mutations after a write failure", async () => {
                    updateConfigurationStub.rejects(new Error("Settings are read-only"));
                    await expectFailure(add("failed"), "Settings are read-only");
                    updateConfigurationStub.resetBehavior();
                    updateConfigurationStub.resolves();

                    await add("saved");

                    expect(stored().map((item) => item.id))
                        .to.include("saved")
                        .and.not.to.include("failed");
                });

                for (const direction of [
                    "global-to-workspace",
                    "workspace-to-global",
                    "folder-to-folder",
                ]) {
                    for (const failure of ["destination", "cleanup"]) {
                        test(`keeps recoverable content when ${direction} ${failure} write fails`, async () => {
                            let source = mockGlobalConfigData;
                            let destination = mockWorkspaceConfigData;
                            let sourceTarget = ConfigurationTarget.Global;
                            let destinationTarget = ConfigurationTarget.Workspace;
                            let sourceUri: string | undefined;
                            let destinationUri: string | undefined;
                            let destinationName =
                                LocalizedConstants.ConnectionConfig.workspaceConfig;
                            if (direction === "workspace-to-global") {
                                source = mockWorkspaceConfigData;
                                destination = mockGlobalConfigData;
                                sourceTarget = ConfigurationTarget.Workspace;
                                destinationTarget = ConfigurationTarget.Global;
                                destinationName = LocalizedConstants.ConnectionConfig.globalConfig;
                            } else if (direction === "folder-to-folder") {
                                const folderOne = addMockWorkspaceFolder("source", 0);
                                const folderTwo = addMockWorkspaceFolder("destination", 1);
                                sourceUri = folderOne.uri.toString();
                                destinationUri = folderTwo.uri.toString();
                                source = mockWorkspaceFolderConfigData.get(sourceUri)!;
                                destination = mockWorkspaceFolderConfigData.get(destinationUri)!;
                                sourceTarget = destinationTarget =
                                    ConfigurationTarget.WorkspaceFolder;
                                destinationName =
                                    LocalizedConstants.ConnectionConfig.workspaceFolderConfig(
                                        folderTwo.name,
                                    );
                            }
                            mockGlobalConfigData.set(
                                setting,
                                stored().filter((item) => item.id !== "target"),
                            );
                            mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, []);
                            source.set(setting, [
                                ...(source.get(setting) ?? []),
                                makeItem("target"),
                                makeItem("source-sibling"),
                                ...(kind === "group"
                                    ? [
                                          {
                                              ...createStoredGroup("nested", "Nested"),
                                              parentId: "target",
                                          },
                                      ]
                                    : []),
                            ]);
                            destination.set(Constants.connectionGroupsArrayName, [
                                ...(destination.get(Constants.connectionGroupsArrayName) ?? []),
                                createStoredGroup("parent", "Destination parent"),
                            ]);
                            destination.set(setting, [
                                ...(destination.get(setting) ?? []),
                                makeItem("destination-sibling"),
                                makeItem("destination-sibling"),
                            ]);
                            if (kind === "group") {
                                source.set(Constants.connectionsArrayName, [
                                    createStoredProfile("nested-profile", "nested"),
                                    createStoredProfile("target-profile", "target"),
                                ]);
                            }
                            const sourceBefore = deepClone(source.get(setting));
                            const destinationBefore = deepClone(destination.get(setting));
                            messageBoxes.showInformationMessage.resolves(
                                moveChoice(destinationName),
                            );
                            updateConfigurationStub.callsFake(
                                async (
                                    key: string,
                                    items: Array<{ id: string }>,
                                    target: ConfigurationTarget,
                                    uri?: string,
                                ) => {
                                    if (
                                        key === setting &&
                                        ((failure === "destination" &&
                                            target === destinationTarget &&
                                            uri === destinationUri) ||
                                            (failure === "cleanup" &&
                                                target === sourceTarget &&
                                                uri === sourceUri &&
                                                !items.some((item) => item.id === "target")))
                                    ) {
                                        throw new Error(`${failure} write failed`);
                                    }
                                },
                            );
                            const logger = createStubLogger(sandbox);
                            config["_logger"] = logger;

                            await expectFailure(
                                update("target", "parent"),
                                `${failure} write failed`,
                            );

                            expect(source.get(setting)).to.deep.equal(sourceBefore);
                            if (failure === "destination") {
                                expect(destination.get(setting)).to.deep.equal(destinationBefore);
                            } else {
                                expect(destination.get(setting)).to.deep.include(
                                    kind === "connection"
                                        ? { ...createStoredProfile("target", "parent") }
                                        : {
                                              ...createStoredGroup("target", "target"),
                                              parentId: "parent",
                                          },
                                );
                            }
                            expect(logger.error).to.have.been.calledWith(
                                sinon.match(`${failure} write failed`),
                            );
                            if (failure === "cleanup") {
                                const destinationAfterFailure = deepClone(destination.get(setting));
                                await expectFailure(
                                    update("target", "parent"),
                                    `${failure} write failed`,
                                );
                                expect(source.get(setting)).to.deep.equal(sourceBefore);
                                expect(destination.get(setting)).to.deep.equal(
                                    destinationAfterFailure,
                                );
                                updateConfigurationStub.resetBehavior();
                                updateConfigurationStub.resolves();

                                expect(await update("target", "parent", "Retried target")).to.be
                                    .true;

                                const physicalStores = [
                                    mockGlobalConfigData,
                                    mockWorkspaceConfigData,
                                    ...mockWorkspaceFolderConfigData.values(),
                                ];
                                const copies = physicalStores.flatMap((store) =>
                                    (store.get(setting) ?? []).filter(
                                        (item: { id: string }) => item.id === "target",
                                    ),
                                );
                                const replacement = {
                                    ...makeItem("target", "parent"),
                                    [kind === "connection" ? "profileName" : "name"]:
                                        "Retried target",
                                };
                                expect(copies).to.deep.equal([replacement]);
                                expect(destination.get(setting)).to.deep.include(replacement);
                                const withoutTarget = (items: Array<{ id: string }>) =>
                                    items.filter((item) => item.id !== "target");
                                expect(source.get(setting)).to.deep.equal(
                                    withoutTarget(sourceBefore),
                                );
                                expect(withoutTarget(destination.get(setting))).to.deep.equal(
                                    withoutTarget(destinationBefore),
                                );
                                if (kind === "group") {
                                    expect(
                                        source.get(Constants.connectionsArrayName),
                                    ).to.deep.equal([
                                        createStoredProfile("nested-profile", "nested"),
                                        createStoredProfile("target-profile", "target"),
                                    ]);
                                    expect(config.getGroupById("nested")?.parentId).to.equal(
                                        "target",
                                    );
                                }
                            }
                        });
                    }
                }
            });
        }

        suite("Connections", () => {
            test("addConnection adds a new connection to profiles", async () => {
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                // Add a connection
                const newProfile: IConnectionProfile = {
                    id: undefined, // This should get populated
                    groupId: undefined, // This should get populated
                    server: "new-server",
                    database: "new-db",
                    authenticationType: "SqlLogin",
                    user: "user",
                    password: "password",
                    profileName: "New Profile",
                    savePassword: false,
                    emptyPasswordInput: false,
                } as IConnectionProfile;

                await connConfig.addConnection(newProfile);

                const savedProfiles = mockGlobalConfigData.get(
                    Constants.connectionsArrayName,
                ) as IConnectionProfile[];

                expect(savedProfiles).to.have.lengthOf(1);
                expect(savedProfiles[0].id).to.not.be.undefined;
                expect(savedProfiles[0].groupId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
                expect(savedProfiles[0].server).to.equal("new-server");
                expect(savedProfiles[0].database).to.equal("new-db");
            });

            test("removeConnection removes an existing connection from profiles", async () => {
                const testConnProfile = {
                    id: "profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "TestServer",
                    profileName: "Test Profile",
                    authenticationType: "Integrated",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [testConnProfile]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const result = await connConfig.removeConnection(testConnProfile);

                expect(result, "Profile should have been found").to.be.true;
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)).to.have.lengthOf(
                    0,
                );
            });

            test("removeConnection does not write config if asked to remove a connection that doesn't exist", async () => {
                const testConnProfile = {
                    id: "profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "TestServer",
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile;

                // Set up initial connections with a different profile
                mockGlobalConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "different-profile-id",
                        groupId: ConnectionConfig.ROOT_GROUP_ID,
                        server: "DifferentServer",
                        authenticationType: "Integrated",
                        profileName: "Different Profile",
                    } as IConnectionProfile,
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                // Try to remove a profile that doesn't exist in the config
                const result = await connConfig.removeConnection(testConnProfile);

                expect(result, "Profile should not have been found").to.be.false;
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)).to.have.lengthOf(
                    1,
                );
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)[0].id).to.equal(
                    "different-profile-id",
                );

                // Verify setConfiguration was not called
                expect(updateConfigurationStub).to.not.have.been.called;
            });

            test("getConnections populates IDs for workspace connections that are missing them", async () => {
                const testConnProfiles = [
                    {
                        // case 1: missing ID
                        id: undefined,
                        groupId: ConnectionConfig.ROOT_GROUP_ID,
                        server: "TestServer",
                        authenticationType: "Integrated",
                        profileName: "Test Profile One",
                    } as IConnectionProfile,
                    {
                        // case 2: missing ID and groupId
                        id: undefined,
                        groupId: undefined,
                        server: "TestServer",
                        authenticationType: "Integrated",
                        profileName: "Test Profile Two",
                    } as IConnectionProfile,
                ];

                mockWorkspaceConfigData.set(Constants.connectionsArrayName, testConnProfiles);
                messageBoxes.showErrorMessage.resolves(undefined);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const result = await connConfig.getConnections();

                expect(result).to.have.lengthOf(2, "All workspace connections should be returned");
                expect(result[0].id).to.be.a("string").that.is.not.empty;
                expect(result[1].id).to.be.a("string").that.is.not.empty;
                expect(result[1].groupId).to.equal(ConnectionConfig.ROOT_GROUP_ID);

                expect(messageBoxes.showErrorMessage).to.have.not.been.called;
            });

            test("getConnections filters out connections that are missing a server", async () => {
                const testConnProfile = {
                    id: "profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "", // missing server should result in this connection being ignored
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [testConnProfile]);

                messageBoxes.showErrorMessage.resolves(undefined);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const result = await connConfig.getConnections();

                expect(result).to.have.lengthOf(
                    0,
                    "Connection missing server should not be returned",
                );

                expect(messageBoxes.showErrorMessage).to.have.been.calledOnce;
            });

            test("updateConnection updates an existing connection profile", async () => {
                const testConnProfile = {
                    id: "profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "TestServer",
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [testConnProfile]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const updatedProfile: IConnectionProfile = {
                    ...testConnProfile,
                    profileName: "Updated Profile",
                };

                await connConfig.updateConnection(updatedProfile);
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)).to.have.lengthOf(
                    1,
                );

                expect(
                    mockGlobalConfigData.get(Constants.connectionsArrayName)[0].profileName,
                ).to.deep.equal("Updated Profile");
            });

            test("updateConnection can move a connection to its parent's configuration location", async () => {
                mockGlobalConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "profile-id",
                        groupId: ConnectionConfig.ROOT_GROUP_ID,
                        server: "TestServer",
                        profileName: "Test Profile",
                    } as IConnectionProfile,
                ]);
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    {
                        id: "workspace-group",
                        name: "Workspace Group",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ]);
                messageBoxes.showInformationMessage.resolves(
                    LocalizedConstants.ConnectionConfig.updateSaveLocation(
                        LocalizedConstants.ConnectionConfig.workspaceConfig,
                    ),
                );
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const connection = (await connConfig.getConnections())[0];
                const updated = await connConfig.updateConnection({
                    ...connection,
                    groupId: "workspace-group",
                });

                expect(updated).to.be.true;
                expect(
                    messageBoxes.showInformationMessage.calledOnceWith(
                        LocalizedConstants.ConnectionConfig.moveToDifferentSaveLocation(
                            "Test Profile",
                            LocalizedConstants.ConnectionConfig.globalConfig,
                            "Workspace Group",
                            LocalizedConstants.ConnectionConfig.workspaceConfig,
                        ),
                        { modal: true },
                        LocalizedConstants.ConnectionConfig.updateSaveLocation(
                            LocalizedConstants.ConnectionConfig.workspaceConfig,
                        ),
                        LocalizedConstants.ConnectionConfig.leaveSaveLocation(
                            LocalizedConstants.ConnectionConfig.globalConfig,
                        ),
                    ),
                ).to.be.true;
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)).to.deep.equal([]);
                expect(
                    mockWorkspaceConfigData.get(Constants.connectionsArrayName),
                ).to.have.lengthOf(1);
                expect(mockWorkspaceConfigData.get(Constants.connectionsArrayName)[0]).to.include({
                    id: "profile-id",
                    groupId: "workspace-group",
                });
            });

            test("updateConnection can keep the current configuration location", async () => {
                mockGlobalConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "profile-id",
                        groupId: ConnectionConfig.ROOT_GROUP_ID,
                        server: "TestServer",
                    } as IConnectionProfile,
                ]);
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    {
                        id: "workspace-group",
                        name: "Workspace Group",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ]);
                messageBoxes.showInformationMessage.resolves(
                    LocalizedConstants.ConnectionConfig.leaveSaveLocation(
                        LocalizedConstants.ConnectionConfig.globalConfig,
                    ),
                );
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const connection = (await connConfig.getConnections())[0];
                const updated = await connConfig.updateConnection({
                    ...connection,
                    groupId: "workspace-group",
                });

                expect(updated).to.be.true;
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)).to.have.lengthOf(
                    1,
                );
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)[0]).to.include({
                    id: "profile-id",
                    groupId: "workspace-group",
                });
                expect(mockWorkspaceConfigData.get(Constants.connectionsArrayName)).to.be.undefined;
            });

            test("updateConnection does not persist a cancelled move", async () => {
                mockGlobalConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "profile-id",
                        groupId: ConnectionConfig.ROOT_GROUP_ID,
                        server: "TestServer",
                    } as IConnectionProfile,
                ]);
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    {
                        id: "workspace-group",
                        name: "Workspace Group",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ]);
                messageBoxes.showInformationMessage.resolves(undefined);
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const connection = (await connConfig.getConnections())[0];
                const updated = await connConfig.updateConnection({
                    ...connection,
                    groupId: "workspace-group",
                });

                expect(updated).to.be.false;
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)).to.have.lengthOf(
                    1,
                );
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)[0]).to.include({
                    id: "profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                });
                expect(mockWorkspaceConfigData.get(Constants.connectionsArrayName)).to.be.undefined;
            });

            test("updateConnection moves to root without changing configuration location", async () => {
                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "profile-id",
                        groupId: "global-group",
                        server: "TestServer",
                    } as IConnectionProfile,
                ]);
                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    {
                        id: "global-group",
                        name: "Global Group",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ]);
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const connection = (await connConfig.getConnections())[0];
                const updated = await connConfig.updateConnection({
                    ...connection,
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                });

                expect(updated).to.be.true;
                expect(messageBoxes.showInformationMessage).to.not.have.been.called;
                expect(
                    mockWorkspaceConfigData.get(Constants.connectionsArrayName),
                ).to.have.lengthOf(1);
                expect(mockWorkspaceConfigData.get(Constants.connectionsArrayName)[0]).to.include({
                    id: "profile-id",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                });
                expect(mockGlobalConfigData.get(Constants.connectionsArrayName)).to.be.undefined;
            });
        });

        suite("Connection Groups", () => {
            test("addGroup adds a new connection group", async () => {
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const newGroup: IConnectionGroup = {
                    name: "Test Group",
                    id: undefined, // This should get populated
                    parentId: ConnectionConfig.ROOT_GROUP_ID,
                    configSource: ConfigurationTarget.Global,
                };

                await connConfig.addGroup(newGroup);

                const savedGroups = mockGlobalConfigData.get(
                    Constants.connectionGroupsArrayName,
                ) as IConnectionGroup[];
                expect(savedGroups).to.have.lengthOf(2); // ROOT + new group
                const addedGroup = savedGroups.find((g) => g.name === "Test Group");
                expect(addedGroup).to.not.be.undefined;
                expect(addedGroup?.id).to.not.be.undefined;
                expect(addedGroup?.parentId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
            });

            test("addGroup reports a localized error when its parent no longer exists", async () => {
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                let error: Error | undefined;

                try {
                    await connConfig.addGroup({
                        id: "new-group",
                        name: "New Group",
                        parentId: "missing-parent",
                        configSource: ConfigurationTarget.Global,
                    });
                } catch (caughtError) {
                    error = caughtError as Error;
                }

                expect(error?.message).to.equal(
                    LocalizedConstants.ConnectionConfig.parentGroupNotFound("missing-parent"),
                );
            });

            test("addGroups orders child-first input and writes once", async () => {
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                updateConfigurationStub.resetHistory();

                await connConfig.addGroups([
                    {
                        id: "child-group",
                        name: "Child Group",
                        parentId: "parent-group",
                        configSource: ConfigurationTarget.Global,
                    },
                    {
                        id: "parent-group",
                        name: "Parent Group",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                        configSource: ConfigurationTarget.Global,
                    },
                ]);

                const savedGroups = mockGlobalConfigData.get(
                    Constants.connectionGroupsArrayName,
                ) as IConnectionGroup[];
                expect(savedGroups.map((group) => group.id)).to.deep.equal([
                    ConnectionConfig.ROOT_GROUP_ID,
                    "parent-group",
                    "child-group",
                ]);
                expect(updateConfigurationStub).to.have.been.calledOnce;
            });

            test("addGroups rejects cyclic input without writing", async () => {
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                updateConfigurationStub.resetHistory();
                let error: Error | undefined;

                try {
                    await connConfig.addGroups([
                        {
                            id: "group-a",
                            name: "Group A",
                            parentId: "group-b",
                            configSource: ConfigurationTarget.Global,
                        },
                        {
                            id: "group-b",
                            name: "Group B",
                            parentId: "group-a",
                            configSource: ConfigurationTarget.Global,
                        },
                    ]);
                } catch (caughtError) {
                    error = caughtError as Error;
                }

                expect(error?.message).to.equal(
                    LocalizedConstants.ConnectionConfig.groupHierarchyContainsCycle,
                );
                expect(updateConfigurationStub).to.not.have.been.called;
            });

            test("updateGroup rejects a stale parent selection that would create a cycle", async () => {
                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    createStoredGroup("group-a", "Group A"),
                    createStoredGroup("group-b", "Group B"),
                ]);
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                const groupA = connConfig.getGroupById("group-a");
                const staleGroupB = connConfig.getGroupById("group-b");
                if (!groupA || !staleGroupB) {
                    throw new Error("Expected both test groups");
                }

                await connConfig.updateGroup({
                    ...groupA,
                    parentId: "group-b",
                });

                let error: Error | undefined;
                try {
                    await connConfig.updateGroup({
                        ...staleGroupB,
                        parentId: "group-a",
                    });
                } catch (caughtError) {
                    error = caughtError as Error;
                }

                expect(error?.message).to.equal(
                    LocalizedConstants.ConnectionConfig.groupMoveCreatesCycle("Group B", "Group A"),
                );
                expect(connConfig.getGroupById("group-a")?.parentId).to.equal("group-b");
                expect(connConfig.getGroupById("group-b")?.parentId).to.equal(
                    ConnectionConfig.ROOT_GROUP_ID,
                );
            });

            test("addGroup inherits a workspace parent's config location", async () => {
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    createStoredGroup("workspace-parent", "Workspace Parent"),
                ]);
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                await connConfig.addGroup({
                    name: "Workspace Child",
                    id: undefined,
                    parentId: "workspace-parent",
                    configSource: ConfigurationTarget.Global,
                });

                const workspaceGroups = getStoredGroups(ConfigurationTarget.Workspace);
                const childGroup = workspaceGroups.find(
                    (group) => group.name === "Workspace Child",
                );
                expect(childGroup?.parentId).to.equal("workspace-parent");
                expect(
                    getStoredGroups(ConfigurationTarget.Global).some(
                        (group) => group.name === "Workspace Child",
                    ),
                ).to.be.false;
            });

            test("addGroup inherits a workspace folder parent's config location", async () => {
                const folder = addMockWorkspaceFolder("folder-parent", 0);
                setWorkspaceFolderData(folder.uri, Constants.connectionGroupsArrayName, [
                    createStoredGroup("folder-parent", "Folder Parent"),
                ]);
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const newGroup: IConnectionGroup = {
                    name: "Folder Child",
                    id: undefined,
                    parentId: "folder-parent",
                    configSource: ConfigurationTarget.Global,
                };
                await connConfig.addGroup(newGroup);

                const folderGroups = getWorkspaceFolderData<IConnectionGroup[]>(
                    folder.uri,
                    Constants.connectionGroupsArrayName,
                );
                const childGroup = folderGroups.find((group) => group.name === "Folder Child");
                expect(childGroup?.parentId).to.equal("folder-parent");
                expect(newGroup.configSource).to.equal(ConfigurationTarget.WorkspaceFolder);
                expect(newGroup.workspaceFolderUri).to.equal(folder.uri.toString());
            });

            test("removeGroup removes an existing group", async () => {
                const testGroup = {
                    name: "Test Group",
                    id: "test-group-id",
                    parentId: ConnectionConfig.ROOT_GROUP_ID,
                };

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
                    testGroup,
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const result = await connConfig.removeGroup(testGroup.id, "delete");

                expect(result, "Group should have been found and removed").to.be.true;
                const savedGroups = mockGlobalConfigData.get(
                    Constants.connectionGroupsArrayName,
                ) as IConnectionGroup[];
                expect(savedGroups).to.have.lengthOf(1); // Only ROOT remains
                expect(savedGroups[0].name).to.equal("ROOT");
            });

            test("removeGroup with delete option removes child groups and their connections recursively", async () => {
                // Set up test groups: Group A with children B and C
                const groupA = {
                    name: "Group A",
                    id: "group-a",
                    parentId: ConnectionConfig.ROOT_GROUP_ID,
                };
                const groupB = { name: "Group B", id: "group-b", parentId: "group-a" };
                const groupC = { name: "Group C", id: "group-c", parentId: "group-a" };

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
                    groupA,
                    groupB,
                    groupC,
                ]);

                // Set up test connections: one in Group B, one in Group A
                const conn1 = {
                    id: "conn1",
                    groupId: "group-a",
                    server: "server1",
                    authenticationType: "Integrated",
                    profileName: "Connection 1",
                } as IConnectionProfile;

                const conn2 = {
                    id: "conn2",
                    groupId: "group-b",
                    server: "server2",
                    authenticationType: "Integrated",
                    profileName: "Connection 2",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [conn1, conn2]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                // Remove Group A
                const result = await connConfig.removeGroup(groupA.id, "delete");

                expect(result, "Group should have been found and removed").to.be.true;

                // Verify groups were removed
                const savedGroups = mockGlobalConfigData.get(
                    Constants.connectionGroupsArrayName,
                ) as IConnectionGroup[];
                expect(savedGroups).to.have.lengthOf(1, "Only ROOT group should remain");
                expect(savedGroups[0].id).to.equal(ConnectionConfig.ROOT_GROUP_ID);

                // Verify connections were removed
                const savedConnections = mockGlobalConfigData.get(
                    Constants.connectionsArrayName,
                ) as IConnectionProfile[];
                expect(savedConnections).to.have.lengthOf(0, "All connections should be removed");
            });

            test("removeGroup with move option moves immediate children to root and removes subgroups", async () => {
                // Set up test groups: Group A with children B and C
                const groupA = {
                    name: "Group A",
                    id: "group-a",
                    parentId: ConnectionConfig.ROOT_GROUP_ID,
                };
                const groupB = { name: "Group B", id: "group-b", parentId: "group-a" };
                const groupC = { name: "Group C", id: "group-c", parentId: "group-a" };

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
                    groupA,
                    groupB,
                    groupC,
                ]);

                // Set up test connections: one in Group A (immediate child), one in Group B (nested)
                const conn1 = {
                    id: "conn1",
                    groupId: "group-a",
                    server: "server1",
                    authenticationType: "Integrated",
                    profileName: "Connection 1",
                } as IConnectionProfile;

                const conn2 = {
                    id: "conn2",
                    groupId: "group-b",
                    server: "server2",
                    authenticationType: "Integrated",
                    profileName: "Connection 2",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [conn1, conn2]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                // Remove Group A with move option
                const result = await connConfig.removeGroup(groupA.id, "move");

                expect(result, "Group should have been found and removed").to.be.true;

                // Verify group A was removed and immediate children (B and C) were moved to root
                const savedGroups = mockGlobalConfigData.get(
                    Constants.connectionGroupsArrayName,
                ) as IConnectionGroup[];
                expect(savedGroups).to.have.lengthOf(3, "ROOT and two child groups should remain");

                // Verify group hierarchy
                const groupB_Saved = savedGroups.find((g) => g.id === groupB.id);
                const groupC_Saved = savedGroups.find((g) => g.id === groupC.id);
                expect(groupB_Saved.parentId).to.equal(
                    ConnectionConfig.ROOT_GROUP_ID,
                    "Group B should be moved to root",
                );
                expect(groupC_Saved.parentId).to.equal(
                    ConnectionConfig.ROOT_GROUP_ID,
                    "Group C should be moved to root",
                );

                // Verify immediate child connection was moved to root, keeping its internal hierarchy
                const savedConnections = mockGlobalConfigData.get(
                    Constants.connectionsArrayName,
                ) as IConnectionProfile[];
                const conn1_Saved = savedConnections.find((c) => c.id === conn1.id);
                expect(conn1_Saved).to.not.be.undefined;
                expect(conn1_Saved.groupId).to.equal(
                    ConnectionConfig.ROOT_GROUP_ID,
                    "Connection 1 should be moved to root",
                );
            });

            test("getGroups returns all connection groups", async () => {
                const testGroups = [
                    { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
                    { name: "Group 1", id: "group1-id", parentId: ConnectionConfig.ROOT_GROUP_ID },
                    { name: "Group 2", id: "group2-id", parentId: ConnectionConfig.ROOT_GROUP_ID },
                ];

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, testGroups);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const groups = await connConfig.getGroups();

                expect(groups).to.have.lengthOf(3);
                expect(groups.map((g) => g.name)).to.have.members(["ROOT", "Group 1", "Group 2"]);
            });

            test("getGroupById returns the correct group", async () => {
                const testGroups = [
                    { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
                    {
                        name: "Test Group",
                        id: "test-group-id",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ];

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, testGroups);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const group = await connConfig.getGroupById("test-group-id");

                expect(group).to.not.be.undefined;
                expect(group?.name).to.equal("Test Group");
                expect(group?.parentId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
            });

            test("getGroupById returns undefined for non-existent group", async () => {
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const group = await connConfig.getGroupById("non-existent-id");

                expect(group).to.be.undefined;
            });

            test("getGroups ignores duplicate workspace group entries", async () => {
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    {
                        name: "Workspace Group",
                        id: "duplicate-id",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                    {
                        name: "Workspace Group Two",
                        id: "duplicate-id",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const groups = await connConfig.getGroups();
                const duplicateGroups = groups.filter((g) => g.id === "duplicate-id");

                expect(duplicateGroups).to.have.lengthOf(1);
            });
        });

        suite("Config sources", () => {
            test("getConnectionsFromSettings tags configSource for each store", async () => {
                mockGlobalConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "global-conn",
                        groupId: ConnectionConfig.ROOT_GROUP_ID,
                        server: "global",
                        authenticationType: "Integrated",
                        profileName: "Global Conn",
                    } as IConnectionProfile,
                ]);

                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    {
                        name: "Workspace Group",
                        id: "workspace-group",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ]);

                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "workspace-conn",
                        groupId: "workspace-group",
                        server: "workspace",
                        authenticationType: "Integrated",
                        profileName: "Workspace Conn",
                    } as IConnectionProfile,
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const allConnections = connConfig.getConnectionsFromSettings();
                const globalConn = allConnections.find((c) => c.id === "global-conn");
                const workspaceConn = allConnections.find((c) => c.id === "workspace-conn");

                expect(globalConn?.configSource).to.equal(ConfigurationTarget.Global);
                expect(workspaceConn?.configSource).to.equal(ConfigurationTarget.Workspace);

                const workspaceOnly = connConfig.getConnectionsFromSettings(
                    ConfigurationTarget.Workspace,
                );
                expect(workspaceOnly).to.have.lengthOf(1);
                expect(workspaceOnly[0].id).to.equal("workspace-conn");
            });

            test("loads connections and groups from every workspace folder", async () => {
                const folderOne = addMockWorkspaceFolder("folder-one", 0);
                const folderTwo = addMockWorkspaceFolder("folder-two", 1);
                setWorkspaceFolderData(folderOne.uri, Constants.connectionGroupsArrayName, [
                    createStoredGroup("folder-one-group", "Folder One Group"),
                ]);
                setWorkspaceFolderData(folderOne.uri, Constants.connectionsArrayName, [
                    createStoredProfile("folder-one-connection", "folder-one-group"),
                ]);
                setWorkspaceFolderData(folderTwo.uri, Constants.connectionGroupsArrayName, [
                    createStoredGroup("folder-two-group", "Folder Two Group"),
                ]);
                setWorkspaceFolderData(folderTwo.uri, Constants.connectionsArrayName, [
                    createStoredProfile("folder-two-connection", "folder-two-group"),
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const connections = connConfig.getConnectionsFromSettings(
                    ConfigurationTarget.WorkspaceFolder,
                );
                const groups = (await connConfig.getGroups()).filter(
                    (group) => group.configSource === ConfigurationTarget.WorkspaceFolder,
                );

                expect(connections.map((connection) => connection.id)).to.have.members([
                    "folder-one-connection",
                    "folder-two-connection",
                ]);
                expect(connections).to.satisfy((items: IConnectionProfile[]) =>
                    items.every(
                        (connection) =>
                            connection.configSource === ConfigurationTarget.WorkspaceFolder &&
                            connection.workspaceFolderUri !== undefined,
                    ),
                );
                expect(
                    connections.find((connection) => connection.id === "folder-one-connection")
                        ?.workspaceFolderUri,
                ).to.equal(folderOne.uri.toString());
                expect(
                    connections.find((connection) => connection.id === "folder-two-connection")
                        ?.workspaceFolderUri,
                ).to.equal(folderTwo.uri.toString());
                expect(groups.map((group) => group.id)).to.have.members([
                    "folder-one-group",
                    "folder-two-group",
                ]);
                expect(groups).to.satisfy((items: IConnectionGroup[]) =>
                    items.every(
                        (group) =>
                            group.configSource === ConfigurationTarget.WorkspaceFolder &&
                            group.workspaceFolderUri !== undefined,
                    ),
                );
            });

            test("loads single-folder connections and groups once through workspace settings", async () => {
                const folder = addMockWorkspaceFolder("single-folder", 0);
                mockWorkspaceFile = undefined;
                const profiles = [
                    createStoredProfile("single-folder-connection", "single-folder-group"),
                ];
                const groups = [createStoredGroup("single-folder-group", "Single Folder Group")];
                mockWorkspaceConfigData.set(Constants.connectionsArrayName, profiles);
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, groups);
                setWorkspaceFolderData(folder.uri, Constants.connectionsArrayName, profiles);
                setWorkspaceFolderData(folder.uri, Constants.connectionGroupsArrayName, groups);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const connections = await connConfig.getConnections();
                expect(connections).to.have.lengthOf(1);
                expect(connections[0]).to.include({
                    id: "single-folder-connection",
                    configSource: ConfigurationTarget.Workspace,
                });
                expect(connections[0]).not.to.have.property("workspaceFolderUri");
                const loadedGroups = await connConfig.getGroups();
                expect(loadedGroups.map((group) => group.id)).to.have.members([
                    ConnectionConfig.ROOT_GROUP_ID,
                    "single-folder-group",
                ]);
                expect(connConfig.getGroupById("single-folder-group")).to.include({
                    configSource: ConfigurationTarget.Workspace,
                });
                expect(connConfig.getConnectionsFromSettings(ConfigurationTarget.WorkspaceFolder))
                    .to.be.empty;
                expect(updateConfigurationStub).not.to.have.been.called;
            });

            test("updates a single-folder connection in workspace settings without duplicating it globally", async () => {
                addMockWorkspaceFolder("single-folder", 0);
                mockWorkspaceFile = undefined;
                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                    createStoredProfile("single-folder-connection", ConnectionConfig.ROOT_GROUP_ID),
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                await connConfig.updateConnection({
                    ...createStoredProfile(
                        "single-folder-connection",
                        ConnectionConfig.ROOT_GROUP_ID,
                    ),
                    profileName: "Updated Single Folder",
                });

                expect(getStoredConnections(ConfigurationTarget.Workspace)).to.have.lengthOf(1);
                expect(getStoredConnections(ConfigurationTarget.Workspace)[0].profileName).to.equal(
                    "Updated Single Folder",
                );
                expect(getStoredConnections(ConfigurationTarget.Global)).to.be.empty;
                expect(updateConfigurationStub).to.have.been.calledWith(
                    Constants.connectionsArrayName,
                    getStoredConnections(ConfigurationTarget.Workspace),
                    ConfigurationTarget.Workspace,
                    undefined,
                );
            });

            test("updates a workspace-folder connection only in its source folder", async () => {
                const folderOne = addMockWorkspaceFolder("folder-one", 0);
                const folderTwo = addMockWorkspaceFolder("folder-two", 1);
                setWorkspaceFolderData(folderOne.uri, Constants.connectionsArrayName, [
                    createStoredProfile("folder-one-connection", ConnectionConfig.ROOT_GROUP_ID),
                ]);
                setWorkspaceFolderData(folderTwo.uri, Constants.connectionsArrayName, [
                    createStoredProfile("folder-two-connection", ConnectionConfig.ROOT_GROUP_ID),
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                const folderOneConnection = connConfig
                    .getConnectionsFromSettings()
                    .find((connection) => connection.id === "folder-one-connection");
                if (!folderOneConnection) {
                    throw new Error("Expected folder-one connection");
                }

                await connConfig.updateConnection({
                    ...folderOneConnection,
                    profileName: "Updated Folder One",
                });

                expect(
                    getWorkspaceFolderData<IConnectionProfile[]>(
                        folderOne.uri,
                        Constants.connectionsArrayName,
                    )[0].profileName,
                ).to.equal("Updated Folder One");
                expect(
                    getWorkspaceFolderData<IConnectionProfile[]>(
                        folderTwo.uri,
                        Constants.connectionsArrayName,
                    )[0].profileName,
                ).to.equal("folder-two-connection");
                expect(mockWorkspaceConfigData.get(Constants.connectionsArrayName)).to.be.undefined;
            });

            test("removes a workspace-folder connection only from its source folder", async () => {
                const folderOne = addMockWorkspaceFolder("folder-one", 0);
                const folderTwo = addMockWorkspaceFolder("folder-two", 1);
                setWorkspaceFolderData(folderOne.uri, Constants.connectionsArrayName, [
                    createStoredProfile("folder-one-connection", ConnectionConfig.ROOT_GROUP_ID),
                ]);
                setWorkspaceFolderData(folderTwo.uri, Constants.connectionsArrayName, [
                    createStoredProfile("folder-two-connection", ConnectionConfig.ROOT_GROUP_ID),
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                const folderOneConnection = connConfig
                    .getConnectionsFromSettings()
                    .find((connection) => connection.id === "folder-one-connection");
                if (!folderOneConnection) {
                    throw new Error("Expected folder-one connection");
                }

                const removed = await connConfig.removeConnection({
                    ...folderOneConnection,
                    workspaceFolderUri: undefined,
                });

                expect(removed).to.be.true;
                expect(
                    getWorkspaceFolderData<IConnectionProfile[]>(
                        folderOne.uri,
                        Constants.connectionsArrayName,
                    ),
                ).to.deep.equal([]);
                expect(
                    getWorkspaceFolderData<IConnectionProfile[]>(
                        folderTwo.uri,
                        Constants.connectionsArrayName,
                    )[0].id,
                ).to.equal("folder-two-connection");
                expect(mockWorkspaceConfigData.get(Constants.connectionsArrayName)).to.be.undefined;
            });

            test("updates a workspace-folder group only in its source folder", async () => {
                const folderOne = addMockWorkspaceFolder("folder-one", 0);
                const folderTwo = addMockWorkspaceFolder("folder-two", 1);
                setWorkspaceFolderData(folderOne.uri, Constants.connectionGroupsArrayName, [
                    createStoredGroup("folder-one-group", "Folder One Group"),
                ]);
                setWorkspaceFolderData(folderTwo.uri, Constants.connectionGroupsArrayName, [
                    createStoredGroup("folder-two-group", "Folder Two Group"),
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                const folderOneGroup = connConfig.getGroupById("folder-one-group");
                if (!folderOneGroup) {
                    throw new Error("Expected folder-one group");
                }

                await connConfig.updateGroup({
                    ...folderOneGroup,
                    name: "Updated Folder One Group",
                });

                expect(
                    getWorkspaceFolderData<IConnectionGroup[]>(
                        folderOne.uri,
                        Constants.connectionGroupsArrayName,
                    )[0].name,
                ).to.equal("Updated Folder One Group");
                expect(
                    getWorkspaceFolderData<IConnectionGroup[]>(
                        folderTwo.uri,
                        Constants.connectionGroupsArrayName,
                    )[0].name,
                ).to.equal("Folder Two Group");
                expect(mockWorkspaceConfigData.get(Constants.connectionGroupsArrayName)).to.be
                    .undefined;
            });

            test("updateGroup can move a group to its parent's configuration location", async () => {
                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    createStoredGroup("global-group", "Global Group"),
                ]);
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    createStoredGroup("workspace-parent", "Workspace Parent"),
                ]);
                messageBoxes.showInformationMessage.resolves(
                    LocalizedConstants.ConnectionConfig.updateSaveLocation(
                        LocalizedConstants.ConnectionConfig.workspaceConfig,
                    ),
                );
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                const group = connConfig.getGroupById("global-group");
                if (!group) {
                    throw new Error("Expected global group");
                }

                const updated = await connConfig.updateGroup({
                    ...group,
                    parentId: "workspace-parent",
                });

                expect(updated).to.be.true;
                expect(messageBoxes.showInformationMessage).to.have.been.calledOnce;
                expect(
                    mockGlobalConfigData
                        .get(Constants.connectionGroupsArrayName)
                        .some((savedGroup: IConnectionGroup) => savedGroup.id === "global-group"),
                ).to.be.false;
                expect(
                    mockWorkspaceConfigData
                        .get(Constants.connectionGroupsArrayName)
                        .find((savedGroup: IConnectionGroup) => savedGroup.id === "global-group"),
                ).to.include({
                    parentId: "workspace-parent",
                });
            });

            test("updateGroup does not persist a cancelled move", async () => {
                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    createStoredGroup("global-group", "Global Group"),
                ]);
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    createStoredGroup("workspace-parent", "Workspace Parent"),
                ]);
                messageBoxes.showInformationMessage.resolves(undefined);
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                const group = connConfig.getGroupById("global-group");
                if (!group) {
                    throw new Error("Expected global group");
                }

                const updated = await connConfig.updateGroup({
                    ...group,
                    parentId: "workspace-parent",
                });

                expect(updated).to.be.false;
                expect(
                    mockGlobalConfigData
                        .get(Constants.connectionGroupsArrayName)
                        .find((savedGroup: IConnectionGroup) => savedGroup.id === "global-group"),
                ).to.include({
                    parentId: ConnectionConfig.ROOT_GROUP_ID,
                });
                expect(
                    mockWorkspaceConfigData
                        .get(Constants.connectionGroupsArrayName)
                        .some((savedGroup: IConnectionGroup) => savedGroup.id === "global-group"),
                ).to.be.false;
            });

            test("cross-folder move choices include the workspace folder names", async () => {
                const folderOne = addMockWorkspaceFolder("folder-one", 0);
                const folderTwo = addMockWorkspaceFolder("folder-two", 1);
                setWorkspaceFolderData(folderOne.uri, Constants.connectionsArrayName, [
                    createStoredProfile("folder-one-connection", ConnectionConfig.ROOT_GROUP_ID),
                ]);
                setWorkspaceFolderData(folderTwo.uri, Constants.connectionGroupsArrayName, [
                    createStoredGroup("folder-two-parent", "Folder Two Parent"),
                ]);
                const folderOneLocation =
                    LocalizedConstants.ConnectionConfig.workspaceFolderConfig("folder-one");
                const folderTwoLocation =
                    LocalizedConstants.ConnectionConfig.workspaceFolderConfig("folder-two");
                messageBoxes.showInformationMessage.resolves(
                    LocalizedConstants.ConnectionConfig.leaveSaveLocation(folderOneLocation),
                );
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                const connection = connConfig
                    .getConnectionsFromSettings()
                    .find((candidate) => candidate.id === "folder-one-connection");
                if (!connection) {
                    throw new Error("Expected folder-one connection");
                }

                const updated = await connConfig.updateConnection({
                    ...connection,
                    groupId: "folder-two-parent",
                });

                expect(updated).to.be.true;
                expect(
                    messageBoxes.showInformationMessage.calledOnceWith(
                        LocalizedConstants.ConnectionConfig.moveToDifferentSaveLocation(
                            "folder-one-connection",
                            folderOneLocation,
                            "Folder Two Parent",
                            folderTwoLocation,
                        ),
                        { modal: true },
                        LocalizedConstants.ConnectionConfig.updateSaveLocation(folderTwoLocation),
                        LocalizedConstants.ConnectionConfig.leaveSaveLocation(folderOneLocation),
                    ),
                ).to.be.true;
            });

            test("getConnectionsFromSettings filters orphaned connections once", async () => {
                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "orphan",
                        groupId: "missing-group",
                        server: "workspace",
                        authenticationType: "Integrated",
                        profileName: "Needs Help",
                    } as IConnectionProfile,
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const connections = connConfig.getConnectionsFromSettings();
                expect(connections).to.have.lengthOf(0);
                expect(showWarningStub).to.have.been.calledOnce;
            });

            test("addConnection respects configSource parameter and strips configSource before persisting", async () => {
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const globalProfile = {
                    id: "global-profile",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "global",
                    authenticationType: "Integrated",
                    profileName: "Global Profile",
                    configSource: ConfigurationTarget.Global,
                } as IConnectionProfile;

                const workspaceProfile = {
                    id: "workspace-profile",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "workspace",
                    authenticationType: "Integrated",
                    profileName: "Workspace Profile",
                    configSource: ConfigurationTarget.Workspace,
                } as IConnectionProfile;

                await connConfig.addConnection(globalProfile);
                await connConfig.addConnection(workspaceProfile);

                const savedGlobal = getStoredConnections(ConfigurationTarget.Global);
                const savedWorkspace = getStoredConnections(ConfigurationTarget.Workspace);

                expect(savedGlobal).to.have.lengthOf(1);
                expect(savedGlobal[0].id).to.equal("global-profile");
                expect(savedGlobal[0]).to.not.have.property("configSource");

                expect(savedWorkspace).to.have.lengthOf(1);
                expect(savedWorkspace[0].id).to.equal("workspace-profile");
                expect(savedWorkspace[0]).to.not.have.property("configSource");
            });

            test("addConnection infers configSource using the existing ID", async () => {
                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "existing",
                        groupId: ConnectionConfig.ROOT_GROUP_ID,
                        server: "workspace",
                        authenticationType: "Integrated",
                        profileName: "Old Name",
                    } as IConnectionProfile,
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                await connConfig.addConnection({
                    id: "existing",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "workspace",
                    authenticationType: "Integrated",
                    profileName: "Updated Name",
                } as IConnectionProfile);

                const workspaceConnections = getStoredConnections(ConfigurationTarget.Workspace);
                const globalConnections = getStoredConnections(ConfigurationTarget.Global);

                expect(workspaceConnections).to.have.lengthOf(1);
                expect(workspaceConnections[0].profileName).to.equal("Updated Name");
                expect(globalConnections).to.have.lengthOf(0);
            });

            test("removeConnection only updates the profile's config source", async () => {
                const globalProfile = {
                    id: "global-profile",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "global",
                    authenticationType: "Integrated",
                    profileName: "Global Profile",
                } as IConnectionProfile;
                const workspaceProfile = {
                    id: "workspace-profile",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "workspace",
                    authenticationType: "Integrated",
                    profileName: "Workspace Profile",
                } as IConnectionProfile;
                mockGlobalConfigData.set(Constants.connectionsArrayName, [globalProfile]);
                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [workspaceProfile]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const removed = await connConfig.removeConnection(workspaceProfile);

                expect(removed).to.be.true;
                expect(getStoredConnections(ConfigurationTarget.Global)).to.deep.equal([
                    globalProfile,
                ]);
                expect(getStoredConnections(ConfigurationTarget.Workspace)).to.deep.equal([]);
            });

            test("addConnection skips writing an unchanged profile", async () => {
                const profile = {
                    id: "existing",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "global",
                    authenticationType: "Integrated",
                    profileName: "Existing Profile",
                } as IConnectionProfile;
                mockGlobalConfigData.set(Constants.connectionsArrayName, [profile]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;
                updateConfigurationStub.resetHistory();

                await connConfig.addConnection({ ...profile });

                expect(updateConfigurationStub).to.not.have.been.called;
            });

            test("updateConnection infers configSource using the existing ID", async () => {
                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "existing",
                        groupId: ConnectionConfig.ROOT_GROUP_ID,
                        server: "old",
                        authenticationType: "Integrated",
                        profileName: "Old Name",
                    } as IConnectionProfile,
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const updatedProfile: IConnectionProfile = {
                    id: "existing",
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                    server: "new",
                    authenticationType: "Integrated",
                    profileName: "Updated Name",
                } as IConnectionProfile;

                await connConfig.updateConnection(updatedProfile);

                const workspaceConnections = getStoredConnections(ConfigurationTarget.Workspace);
                const globalConnections = getStoredConnections(ConfigurationTarget.Global);

                expect(workspaceConnections).to.have.lengthOf(1);
                expect(workspaceConnections[0].profileName).to.equal("Updated Name");
                expect(globalConnections).to.have.lengthOf(0);
            });

            test("addGroup writes to requested config source and strips configSource", async () => {
                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                const newGroup: IConnectionGroup = {
                    id: undefined,
                    name: "Workspace Child",
                    parentId: ConnectionConfig.ROOT_GROUP_ID,
                    configSource: ConfigurationTarget.Workspace,
                };

                await connConfig.addGroup(newGroup);

                const workspaceGroups = getStoredGroups(ConfigurationTarget.Workspace);
                expect(workspaceGroups).to.have.lengthOf(1);
                expect(workspaceGroups[0]).to.not.have.property("configSource");
                expect(workspaceGroups[0].name).to.equal("Workspace Child");
            });

            test("getConnections ignores duplicate entries within a store", async () => {
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    {
                        name: "Workspace Group",
                        id: "workspace-group",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ]);

                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "dupicate-id",
                        groupId: "workspace-group",
                        server: "workspace",
                        authenticationType: "Integrated",
                        profileName: "Workspace Conn One",
                    } as IConnectionProfile,
                    {
                        id: "dupicate-id",
                        groupId: "workspace-group",
                        server: "workspace",
                        authenticationType: "Integrated",
                        profileName: "Workspace Conn Two",
                    } as IConnectionProfile,
                ]);

                const connConfig = new ConnectionConfig();
                await connConfig.initialized;

                let connections = await connConfig.getConnections();
                connections = connections.filter((c) => c.id === "dupicate-id");
                expect(connections).to.have.lengthOf(1);
            });
        });
    });

    suite("validateDefaultConnectionId", () => {
        let showWarningAdvancedStub: sinon.SinonStub;

        /** Stubs getConfiguration() (no section) to return a plain config object with given values. */
        function stubRootConfig(behavior: string | undefined, defaultId: string | undefined): void {
            const getStub = sandbox.stub();
            getStub.withArgs(Constants.configNewEditorConnectionBehavior).returns(behavior);
            getStub.withArgs(Constants.configDefaultConnectionId).returns(defaultId);

            rootConfigurationGetStub = getStub;
        }

        setup(() => {
            showWarningAdvancedStub = messageBoxes.showWarningMessage.resolves(undefined);
        });

        test("prompts when behavior is defaultConnection but defaultConnectionId is empty", async () => {
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, "");

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 10));

            expect(showWarningAdvancedStub).to.have.been.calledOnce;
            const [msg] = showWarningAdvancedStub.firstCall.args;
            expect(msg).to.include("mssql.defaultConnectionId");
        });

        test("prompts when behavior is defaultConnection but defaultConnectionId is undefined", async () => {
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, undefined);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 10));

            expect(showWarningAdvancedStub).to.have.been.calledOnce;
        });

        test("prompts with not-found message when ID is set but unknown", async () => {
            const unknownId = "not-a-real-guid";
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, unknownId);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 10));

            expect(showWarningAdvancedStub).to.have.been.calledOnce;
            const [msg] = showWarningAdvancedStub.firstCall.args;
            expect(msg).to.include(unknownId);
        });

        test("prompt buttons include 'Select Connection' and 'Change Setting'", async () => {
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, "");

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 10));

            const [, , ...items] = showWarningAdvancedStub.firstCall.args as [
                string,
                unknown,
                ...string[],
            ];
            expect(items).to.include(
                LocalizedConstants.Connection.defaultConnectionSelectConnection,
            );
            expect(items).to.include(LocalizedConstants.Connection.defaultConnectionChangeSetting);
        });

        test("does not prompt when behavior is not defaultConnection", async () => {
            stubRootConfig(Constants.NewEditorConnectionBehavior.TransferActive, "some-id");

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 10));

            expect(showWarningAdvancedStub).to.not.have.been.called;
        });

        test("does not prompt when behavior is defaultConnection and a matching profile exists", async () => {
            const validId = "valid-conn-id";
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, validId);

            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    id: validId,
                    server: "myserver",
                    authenticationType: "Integrated",
                    profileName: "Valid Profile",
                } as IConnectionProfile,
            ]);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 10));

            expect(showWarningAdvancedStub).to.not.have.been.called;
        });

        test("only shows the prompt once per session", async () => {
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, "");

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 10));

            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 10));

            expect(showWarningAdvancedStub).to.have.been.calledOnce;
        });

        test("saves chosen connection ID when user picks 'Select Connection'", async () => {
            const savedProfile: IConnectionProfile = {
                id: "saved-conn-id",
                server: "myserver",
                authenticationType: "Integrated",
                profileName: "My Server",
            } as IConnectionProfile;

            mockGlobalConfigData.set(Constants.connectionsArrayName, [savedProfile]);
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, "");

            showWarningAdvancedStub.resolves(
                LocalizedConstants.Connection.defaultConnectionSelectConnection,
            );
            showQuickPickStub.resolves({ profile: savedProfile } as any);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 50));

            expect(updateConfigurationStub).to.have.been.calledWith(
                "defaultConnectionId",
                savedProfile.id,
                vscode.ConfigurationTarget.Global,
            );
        });

        test("saves chosen behavior when user picks 'Change Setting' → transferActive", async () => {
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, "");

            showWarningAdvancedStub.resolves(
                LocalizedConstants.Connection.defaultConnectionChangeSetting,
            );
            showQuickPickStub.resolves({
                value: Constants.NewEditorConnectionBehavior.TransferActive,
            } as any);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 50));

            expect(updateConfigurationStub).to.have.been.calledWith(
                "newEditorConnectionBehavior",
                Constants.NewEditorConnectionBehavior.TransferActive,
                vscode.ConfigurationTarget.Global,
            );
        });

        test("saves chosen behavior when user picks 'Change Setting' → none", async () => {
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, "");

            showWarningAdvancedStub.resolves(
                LocalizedConstants.Connection.defaultConnectionChangeSetting,
            );
            showQuickPickStub.resolves({
                value: Constants.NewEditorConnectionBehavior.None,
            } as any);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 50));

            expect(updateConfigurationStub).to.have.been.calledWith(
                "newEditorConnectionBehavior",
                Constants.NewEditorConnectionBehavior.None,
                vscode.ConfigurationTarget.Global,
            );
        });

        test("does nothing when user dismisses the prompt", async () => {
            stubRootConfig(Constants.NewEditorConnectionBehavior.DefaultConnection, "");
            showWarningAdvancedStub.resolves(undefined);

            const connConfig = new ConnectionConfig();
            await connConfig.initialized;
            await new Promise((r) => setTimeout(r, 50));

            expect(updateConfigurationStub).to.not.have.been.calledWith(
                "defaultConnectionId",
                sinon.match.any,
                sinon.match.any,
            );
            expect(updateConfigurationStub).to.not.have.been.calledWith(
                "newEditorConnectionBehavior",
                sinon.match.any,
                sinon.match.any,
            );
        });
    });

    suite("Dependency injection", () => {
        test("Resolves a cached ConnectionConfig instance that finishes initialization", async () => {
            const builder = new InstantiationServiceBuilder();
            builder.define(IConnectionConfig, new ServiceDescriptor(ConnectionConfig));
            const instantiationService = builder.seal();

            const first = instantiationService.invokeFunction((accessor) =>
                accessor.get(IConnectionConfig),
            );
            const second = instantiationService.invokeFunction((accessor) =>
                accessor.get(IConnectionConfig),
            );

            expect(first).to.equal(second);

            await first.initialized;

            const savedGroups = mockGlobalConfigData.get(
                Constants.connectionGroupsArrayName,
            ) as IConnectionGroup[];
            expect(savedGroups).to.have.lengthOf(1);
            expect(savedGroups[0].id).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        });
    });
});
