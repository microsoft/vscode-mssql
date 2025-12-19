/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { IConnectionGroup, IConnectionProfile } from "../../src/models/interfaces";
import * as Constants from "../../src/constants/constants";
import { deepClone } from "../../src/models/utils";
import { stubVscodeWrapper } from "./utils";

const { expect } = chai;

chai.use(sinonChai);

suite("ConnectionConfig Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let showWarningStub: sinon.SinonStub;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    let mockGlobalConfigData: Map<string, any> = new Map();
    let mockWorkspaceConfigData: Map<string, any> = new Map();
    /* eslint-enable @typescript-eslint/no-explicit-any */

    setup(() => {
        sandbox = sinon.createSandbox();

        mockGlobalConfigData = new Map();
        mockWorkspaceConfigData = new Map();
        mockVscodeWrapper = stubVscodeWrapper(sandbox);

        const mockConfiguration = {
            inspect: (setting: string) => {
                let result;
                if (setting === Constants.connectionsArrayName) {
                    result = {
                        globalValue: mockGlobalConfigData.get(Constants.connectionsArrayName) || [],
                        workspaceValue:
                            mockWorkspaceConfigData.get(Constants.connectionsArrayName) || [],
                        workspaceFolderValue: [],
                    };
                } else if (setting === Constants.connectionGroupsArrayName) {
                    result = {
                        globalValue:
                            mockGlobalConfigData.get(Constants.connectionGroupsArrayName) || [],
                        workspaceValue:
                            mockWorkspaceConfigData.get(Constants.connectionGroupsArrayName) || [],
                        workspaceFolderValue: [],
                    };
                } else {
                    result = { globalValue: undefined };
                }
                return deepClone(result);
            },
        };
        const workspaceConfiguration = mockConfiguration as vscode.WorkspaceConfiguration;

        mockVscodeWrapper.getConfiguration.callsFake((section: string) =>
            section === Constants.extensionName ? workspaceConfiguration : undefined,
        );

        mockVscodeWrapper.setConfiguration.callsFake(async (_section, key, value, target) => {
            const targetStore =
                target === ConfigurationTarget.Workspace ||
                target === ConfigurationTarget.WorkspaceFolder
                    ? mockWorkspaceConfigData
                    : mockGlobalConfigData;
            targetStore.set(key, deepClone(value));
        });

        sandbox.stub(mockVscodeWrapper, "activeTextEditorUri").get(() => undefined);

        mockVscodeWrapper.showErrorMessage.resolves(undefined);
        showWarningStub = mockVscodeWrapper.showWarningMessage.resolves(undefined);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Initialization", () => {
        test("Initialization creates ROOT group when it doesn't exist", async () => {
            const config = new ConnectionConfig(mockVscodeWrapper);
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

            const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

        test("Initialization adds IDs to groups without IDs", async () => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
                { name: "Group without ID" } as IConnectionGroup, // Missing ID
            ]);

            const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

            const connConfig = new ConnectionConfig(mockVscodeWrapper);
            await connConfig.initialized;

            const savedProfiles = mockGlobalConfigData.get(
                Constants.connectionsArrayName,
            ) as IConnectionProfile[];
            expect(savedProfiles).to.have.lengthOf(1);
            expect(savedProfiles[0].id).to.not.be.undefined;
            expect(savedProfiles[0].groupId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
        });

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

            const connConfig = new ConnectionConfig(mockVscodeWrapper);
            await connConfig.initialized;

            // Verify setConfiguration was not called since no changes needed
            expect(mockVscodeWrapper.setConfiguration).to.not.have.been.called;
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

    suite("Functions", () => {
        setup(() => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: ConnectionConfig.ROOT_GROUP_ID },
            ]);
        });

        suite("Connections", () => {
            test("addConnection adds a new connection to profiles", async () => {
                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [testConnProfile]);

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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
                expect(mockVscodeWrapper.setConfiguration).to.not.have.been.called;
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
                mockVscodeWrapper.showErrorMessage.resolves(undefined);

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
                await connConfig.initialized;

                const result = await connConfig.getConnections();

                expect(result).to.have.lengthOf(2, "All workspace connections should be returned");
                expect(result[0].id).to.be.a("string").that.is.not.empty;
                expect(result[1].id).to.be.a("string").that.is.not.empty;
                expect(result[1].groupId).to.equal(ConnectionConfig.ROOT_GROUP_ID);

                expect(mockVscodeWrapper.showErrorMessage).to.have.not.been.called;
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

                mockVscodeWrapper;
                mockVscodeWrapper.showErrorMessage.resolves(undefined);

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
                await connConfig.initialized;

                const result = await connConfig.getConnections(false /* getWorkspaceConnections */);

                expect(result).to.have.lengthOf(
                    0,
                    "Connection missing server should not be returned",
                );

                expect(mockVscodeWrapper.showErrorMessage).to.have.been.calledOnce;
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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
        });

        suite("Connection Groups", () => {
            test("addGroup adds a new connection group", async () => {
                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
                await connConfig.initialized;

                const group = await connConfig.getGroupById("test-group-id");

                expect(group).to.not.be.undefined;
                expect(group?.name).to.equal("Test Group");
                expect(group?.parentId).to.equal(ConnectionConfig.ROOT_GROUP_ID);
            });

            test("getGroupById returns undefined for non-existent group", async () => {
                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
                await connConfig.initialized;

                const connections = connConfig.getConnectionsFromSettings();
                expect(connections).to.have.lengthOf(0);
                expect(showWarningStub).to.have.been.calledOnce;
            });

            test("addConnection respects configSource parameter and strips configSource before persisting", async () => {
                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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
                const connConfig = new ConnectionConfig(mockVscodeWrapper);
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

            test("getConnectionsFromSettings ignores duplicate entries within a store", async () => {
                mockWorkspaceConfigData.set(Constants.connectionGroupsArrayName, [
                    {
                        name: "Workspace Group",
                        id: "workspace-group",
                        parentId: ConnectionConfig.ROOT_GROUP_ID,
                    },
                ]);

                mockWorkspaceConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "dup-conn",
                        groupId: "workspace-group",
                        server: "workspace",
                        authenticationType: "Integrated",
                        profileName: "Workspace Conn",
                    } as IConnectionProfile,
                    {
                        id: "dup-conn",
                        groupId: "workspace-group",
                        server: "workspace",
                        authenticationType: "Integrated",
                        profileName: "Workspace Conn",
                    } as IConnectionProfile,
                ]);

                const connConfig = new ConnectionConfig(mockVscodeWrapper);
                await connConfig.initialized;

                const workspaceConnections = connConfig.getConnectionsFromSettings(
                    ConfigurationTarget.Workspace,
                );
                expect(workspaceConnections).to.have.lengthOf(1);
            });
        });
    });
});
