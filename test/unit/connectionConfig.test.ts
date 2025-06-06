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
            expect(nonRootGroup?.groupId).to.equal(rootGroupId);
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
            expect(mockGlobalConfigData.get(Constants.connectionsArrayName)).to.have.lengthOf(0);
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

            expect(result).to.have.lengthOf(0, "Connection missing server should not be returned");

            mockVscodeWrapper.verify(
                (v) => v.showErrorMessage(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });
});
