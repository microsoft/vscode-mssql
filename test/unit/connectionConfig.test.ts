/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as sinon from "sinon";
import { expect } from "chai";
import { IConnectionGroup, IConnectionProfile } from "../../src/models/interfaces";
import * as Constants from "../../src/constants/constants";
import { deepClone } from "../../src/models/utils";

suite("ConnectionConfig Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let outputChannel: TypeMoq.IMock<vscode.OutputChannel>;

    const rootGroupId = "root-group-id";
    let mockGlobalConfigData: Map<string, any> = new Map();
    let mockWorkspaceConfigData: Map<string, any> = new Map();

    setup(() => {
        sandbox = sinon.createSandbox();

        // Reset test data
        mockGlobalConfigData = new Map();
        mockWorkspaceConfigData = new Map();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();

        outputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        outputChannel.setup((c) => c.clear());
        outputChannel.setup((c) => c.append(TypeMoq.It.isAny()));
        outputChannel.setup((c) => c.show(TypeMoq.It.isAny()));

        mockVscodeWrapper.setup((v) => v.outputChannel).returns(() => outputChannel.object);

        const mockConfiguration: any = {
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

        mockVscodeWrapper
            .setup((x) =>
                x.getConfiguration(TypeMoq.It.isValue(Constants.extensionName), TypeMoq.It.isAny()),
            )
            .returns(() => mockConfiguration);

        // like the acutal connection config, only supports writing to Global/User config, not workspace
        mockVscodeWrapper
            .setup((x) =>
                x.setConfiguration(
                    TypeMoq.It.isValue(Constants.extensionName),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            )
            .callback((_section, key, value) => {
                mockGlobalConfigData.set(key, deepClone(value));
                return Promise.resolve();
            })
            .returns(() => Promise.resolve());

        mockVscodeWrapper.setup((x) => x.activeTextEditorUri).returns(() => undefined);

        mockVscodeWrapper
            .setup((x) => x.outputChannel)
            .returns(
                () =>
                    ({
                        appendLine: () => {},
                        clear: () => {},
                        show: () => {},
                    }) as any,
            );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Initialization", () => {
        test("Initialization creates ROOT group when it doesn't exist", async () => {
            const config = new ConnectionConfig(mockVscodeWrapper.object);
            await config.initialized;

            const savedGroups = mockGlobalConfigData.get(
                Constants.connectionGroupsArrayName,
            ) as IConnectionGroup[];

            expect(savedGroups).to.have.lengthOf(1);
            expect(savedGroups[0].name).to.equal("ROOT");
            expect(savedGroups[0].id).to.not.be.undefined;
        });

        test("Initialization adds IDs to groups without IDs", async () => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: rootGroupId },
                { name: "Group without ID" } as IConnectionGroup, // Missing ID
            ]);

            const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
            await connConfig.initialized;

            const savedGroups = mockGlobalConfigData.get(
                Constants.connectionGroupsArrayName,
            ) as IConnectionGroup[];
            expect(savedGroups).to.have.lengthOf(2);

            const nonRootGroup = savedGroups.find((g) => g.name === "Group without ID");
            expect(nonRootGroup).to.not.be.undefined;
            expect(nonRootGroup?.id).to.not.be.undefined;
            expect(nonRootGroup?.parentId).to.equal(rootGroupId);
        });

        test("Initialization adds missing IDs to connection profiles", async () => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: rootGroupId },
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

            const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
            await connConfig.initialized;

            const savedProfiles = mockGlobalConfigData.get(
                Constants.connectionsArrayName,
            ) as IConnectionProfile[];
            expect(savedProfiles).to.have.lengthOf(1);
            expect(savedProfiles[0].id).to.not.be.undefined;
            expect(savedProfiles[0].groupId).to.equal(rootGroupId);
        });

        test("Initialization doesn't make changes when all IDs are present", async () => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: rootGroupId },
            ]);

            mockGlobalConfigData.set(Constants.connectionsArrayName, [
                {
                    id: "profile-id",
                    groupId: rootGroupId,
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

            const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
            await connConfig.initialized;

            // Verify setConfiguration was not called since no changes needed
            mockVscodeWrapper.verify(
                (v) =>
                    v.setConfiguration(
                        TypeMoq.It.isValue(Constants.extensionName),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                TypeMoq.Times.never(),
            );
        });
    });

    suite("Functions", () => {
        setup(() => {
            mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                { name: "ROOT", id: rootGroupId },
            ]);
        });

        suite("Connections", () => {
            test("addConnection adds a new connection to profiles", async () => {
                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
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
                expect(savedProfiles[0].groupId).to.equal(rootGroupId);
                expect(savedProfiles[0].server).to.equal("new-server");
                expect(savedProfiles[0].database).to.equal("new-db");
            });

            test("removeConnection removes an existing connection from profiles", async () => {
                const testConnProfile = {
                    id: "profile-id",
                    groupId: rootGroupId,
                    server: "TestServer",
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [testConnProfile]);

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
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
                    groupId: rootGroupId,
                    server: "TestServer",
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile;

                // Set up initial connections with a different profile
                mockGlobalConfigData.set(Constants.connectionsArrayName, [
                    {
                        id: "different-profile-id",
                        groupId: rootGroupId,
                        server: "DifferentServer",
                        authenticationType: "Integrated",
                        profileName: "Different Profile",
                    } as IConnectionProfile,
                ]);

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
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
                mockVscodeWrapper.verify(
                    (v) =>
                        v.setConfiguration(
                            TypeMoq.It.isValue(Constants.extensionName),
                            TypeMoq.It.isAny(),
                            TypeMoq.It.isAny(),
                        ),
                    TypeMoq.Times.never(),
                );
            });

            test("getConnections filters out workspace connections that are missing IDs", async () => {
                const testConnProfiles = [
                    {
                        id: undefined, // missing ID won't get automatically populated for workspace connections
                        groupId: rootGroupId,
                        server: "TestServer",
                        authenticationType: "Integrated",
                        profileName: "Test Profile One",
                    } as IConnectionProfile,
                    {
                        id: undefined, // missing ID won't get automatically populated for workspace connections
                        groupId: rootGroupId,
                        server: "TestServer",
                        authenticationType: "Integrated",
                        profileName: "Test Profile Two",
                    } as IConnectionProfile,
                ];

                mockWorkspaceConfigData.set(Constants.connectionsArrayName, testConnProfiles);

                mockVscodeWrapper
                    .setup((x) => x.showErrorMessage(TypeMoq.It.isAny()))
                    .returns(() => {
                        return Promise.resolve(undefined);
                    });

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
                await connConfig.initialized;

                const result = await connConfig.getConnections(true /* getWorkspaceConnections */);

                expect(result).to.have.lengthOf(
                    0,
                    "Workspace connection missing ID should not be returned",
                );

                mockVscodeWrapper.verify(
                    (v) =>
                        v.showErrorMessage(
                            TypeMoq.It.is(
                                (msg) =>
                                    msg.includes("Test Profile One") &&
                                    msg.includes("Test Profile Two"),
                            ),
                        ),
                    TypeMoq.Times.once(),
                );
            });

            test("getConnections filters out connections that are missing a server", async () => {
                const testConnProfile = {
                    id: "profile-id",
                    groupId: rootGroupId,
                    server: "", // missing server should result in this connection being ignored
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [testConnProfile]);

                mockVscodeWrapper
                    .setup((x) => x.showErrorMessage(TypeMoq.It.isAny()))
                    .returns(() => {
                        return Promise.resolve(undefined);
                    });

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
                await connConfig.initialized;

                const result = await connConfig.getConnections(false /* getWorkspaceConnections */);

                expect(result).to.have.lengthOf(
                    0,
                    "Connection missing server should not be returned",
                );

                mockVscodeWrapper.verify(
                    (v) => v.showErrorMessage(TypeMoq.It.isAny()),
                    TypeMoq.Times.once(),
                );
            });

            test("updateConnection updates an existing connection profile", async () => {
                const testConnProfile = {
                    id: "profile-id",
                    groupId: rootGroupId,
                    server: "TestServer",
                    authenticationType: "Integrated",
                    profileName: "Test Profile",
                } as IConnectionProfile;

                mockGlobalConfigData.set(Constants.connectionsArrayName, [testConnProfile]);

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
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
                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
                await connConfig.initialized;

                const newGroup: IConnectionGroup = {
                    name: "Test Group",
                    id: undefined, // This should get populated
                    parentId: rootGroupId,
                };

                await connConfig.addGroup(newGroup);

                const savedGroups = mockGlobalConfigData.get(
                    Constants.connectionGroupsArrayName,
                ) as IConnectionGroup[];
                expect(savedGroups).to.have.lengthOf(2); // ROOT + new group
                const addedGroup = savedGroups.find((g) => g.name === "Test Group");
                expect(addedGroup).to.not.be.undefined;
                expect(addedGroup?.id).to.not.be.undefined;
                expect(addedGroup?.parentId).to.equal(rootGroupId);
            });

            test("removeGroup removes an existing group", async () => {
                const testGroup = {
                    name: "Test Group",
                    id: "test-group-id",
                    parentId: rootGroupId,
                };

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    { name: "ROOT", id: rootGroupId },
                    testGroup,
                ]);

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
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
                const groupA = { name: "Group A", id: "group-a", parentId: rootGroupId };
                const groupB = { name: "Group B", id: "group-b", parentId: "group-a" };
                const groupC = { name: "Group C", id: "group-c", parentId: "group-a" };

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    { name: "ROOT", id: rootGroupId },
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
                await connConfig.initialized;

                // Remove Group A
                const result = await connConfig.removeGroup(groupA.id, "delete");

                expect(result, "Group should have been found and removed").to.be.true;

                // Verify groups were removed
                const savedGroups = mockGlobalConfigData.get(
                    Constants.connectionGroupsArrayName,
                ) as IConnectionGroup[];
                expect(savedGroups).to.have.lengthOf(1, "Only ROOT group should remain");
                expect(savedGroups[0].id).to.equal(rootGroupId);

                // Verify connections were removed
                const savedConnections = mockGlobalConfigData.get(
                    Constants.connectionsArrayName,
                ) as IConnectionProfile[];
                expect(savedConnections).to.have.lengthOf(0, "All connections should be removed");
            });

            test("removeGroup with move option moves immediate children to root and removes subgroups", async () => {
                // Set up test groups: Group A with children B and C
                const groupA = { name: "Group A", id: "group-a", parentId: rootGroupId };
                const groupB = { name: "Group B", id: "group-b", parentId: "group-a" };
                const groupC = { name: "Group C", id: "group-c", parentId: "group-a" };

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, [
                    { name: "ROOT", id: rootGroupId },
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

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
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
                    rootGroupId,
                    "Group B should be moved to root",
                );
                expect(groupC_Saved.parentId).to.equal(
                    rootGroupId,
                    "Group C should be moved to root",
                );

                // Verify immediate child connection was moved to root, keeping its internal hierarchy
                const savedConnections = mockGlobalConfigData.get(
                    Constants.connectionsArrayName,
                ) as IConnectionProfile[];
                const conn1_Saved = savedConnections.find((c) => c.id === conn1.id);
                expect(conn1_Saved).to.not.be.undefined;
                expect(conn1_Saved.groupId).to.equal(
                    rootGroupId,
                    "Connection 1 should be moved to root",
                );
            });

            test("getGroups returns all connection groups", async () => {
                const testGroups = [
                    { name: "ROOT", id: rootGroupId },
                    { name: "Group 1", id: "group1-id", parentId: rootGroupId },
                    { name: "Group 2", id: "group2-id", parentId: rootGroupId },
                ];

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, testGroups);

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
                await connConfig.initialized;

                const groups = await connConfig.getGroups();

                expect(groups).to.have.lengthOf(3);
                expect(groups.map((g) => g.name)).to.have.members(["ROOT", "Group 1", "Group 2"]);
            });

            test("getGroupById returns the correct group", async () => {
                const testGroups = [
                    { name: "ROOT", id: rootGroupId },
                    { name: "Test Group", id: "test-group-id", parentId: rootGroupId },
                ];

                mockGlobalConfigData.set(Constants.connectionGroupsArrayName, testGroups);

                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
                await connConfig.initialized;

                const group = await connConfig.getGroupById("test-group-id");

                expect(group).to.not.be.undefined;
                expect(group?.name).to.equal("Test Group");
                expect(group?.parentId).to.equal(rootGroupId);
            });

            test("getGroupById returns undefined for non-existent group", async () => {
                const connConfig = new ConnectionConfig(mockVscodeWrapper.object);
                await connConfig.initialized;

                const group = await connConfig.getGroupById("non-existent-id");

                expect(group).to.be.undefined;
            });
        });
    });
});
