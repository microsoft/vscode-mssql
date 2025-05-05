/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as sinon from "sinon";
import { expect } from "chai";
import { IConnectionGroup, IConnectionProfile } from "../../src/models/interfaces";

suite("ConnectionConfig Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    // Store original methods
    let originalGetGroupsFromSettings: any;
    let originalGetProfilesFromSettings: any;
    let originalWriteGroupsToSettings: any;
    let originalWriteProfilesToSettings: any;
    let originalAssignMissingIds: any;

    // Variables for tracking method calls and test data
    let groupsFromSettings: IConnectionGroup[];
    let profilesFromSettings: IConnectionProfile[];
    let groupsWritten: IConnectionGroup[];
    let profilesWritten: IConnectionProfile[];
    let groupsWriteCalled: boolean;
    let profilesWriteCalled: boolean;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();

        // Store original methods before mocking
        originalGetGroupsFromSettings = ConnectionConfig.prototype["getGroupsFromSettings"];
        originalGetProfilesFromSettings = ConnectionConfig.prototype["getProfilesFromSettings"];
        originalWriteGroupsToSettings =
            ConnectionConfig.prototype["writeConnectionGroupsToSettings"];
        originalWriteProfilesToSettings = ConnectionConfig.prototype["writeProfilesToSettings"];
        originalAssignMissingIds = ConnectionConfig.prototype["assignMissingIds"];

        // Initialize tracking variables
        groupsFromSettings = [];
        profilesFromSettings = [];
        groupsWritten = [];
        profilesWritten = [];
        groupsWriteCalled = false;
        profilesWriteCalled = false;

        // Set up default mock implementations
        ConnectionConfig.prototype["getGroupsFromSettings"] = function (): IConnectionGroup[] {
            return groupsFromSettings;
        };

        ConnectionConfig.prototype["getProfilesFromSettings"] = function (): IConnectionProfile[] {
            return profilesFromSettings;
        };

        ConnectionConfig.prototype["writeConnectionGroupsToSettings"] = async function (
            groups: IConnectionGroup[],
        ): Promise<void> {
            groupsWritten = groups;
            groupsWriteCalled = true;
            return Promise.resolve();
        };

        ConnectionConfig.prototype["writeProfilesToSettings"] = async function (
            profiles: IConnectionProfile[],
        ): Promise<void> {
            profilesWritten = profiles;
            profilesWriteCalled = true;
            return Promise.resolve();
        };
    });

    teardown(() => {
        // Restore original methods
        ConnectionConfig.prototype["getGroupsFromSettings"] = originalGetGroupsFromSettings;
        ConnectionConfig.prototype["getProfilesFromSettings"] = originalGetProfilesFromSettings;
        ConnectionConfig.prototype["writeConnectionGroupsToSettings"] =
            originalWriteGroupsToSettings;
        ConnectionConfig.prototype["writeProfilesToSettings"] = originalWriteProfilesToSettings;
        ConnectionConfig.prototype["assignMissingIds"] = originalAssignMissingIds;

        // Clean up any other resources
        sandbox.restore();
    });

    test("assignMissingIds creates ROOT group if it doesn't exist", async () => {
        const config = new ConnectionConfig(mockVscodeWrapper.object);
        await config.initialized;

        expect(groupsWritten).to.have.lengthOf(1);
        expect(groupsWritten[0].name).to.equal("ROOT");
        expect(groupsWritten[0].id).to.not.be.undefined;
    });

    test("assignMissingIds adds IDs to groups without IDs", async () => {
        const rootGroupId = "root-group-id";
        groupsFromSettings = [
            { name: "ROOT", id: rootGroupId },
            { name: "Group without ID" } as IConnectionGroup, // Missing ID
        ];

        const config = new ConnectionConfig(mockVscodeWrapper.object);
        await config.initialized;

        expect(groupsWritten).to.have.lengthOf(2);
        const nonRootGroup = groupsWritten.find((g) => g.name === "Group without ID");
        expect(nonRootGroup).to.not.be.undefined;
        expect(nonRootGroup.id).to.not.be.undefined;
        expect(nonRootGroup.groupId).to.equal(rootGroupId);
    });

    test("assignMissingIds adds missing IDs to connection profiles", async () => {
        const rootGroupId = "root-group-id";
        groupsFromSettings = [{ name: "ROOT", id: rootGroupId }];

        profilesFromSettings = [
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
        ];

        const config = new ConnectionConfig(mockVscodeWrapper.object);
        await config.initialized;

        expect(profilesWritten).to.have.lengthOf(1);
        const profile = profilesWritten[0];
        expect(profile.id).to.not.be.undefined;
        expect(profile.groupId).to.equal(rootGroupId);
    });

    test("assignMissingIds doesn't make changes when all IDs are present", async () => {
        const rootGroupId = "root-group-id";
        const profileId = "profile-id";

        groupsFromSettings = [{ name: "ROOT", id: rootGroupId }];

        profilesFromSettings = [
            {
                id: profileId,
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
        ];

        groupsWriteCalled = false;
        profilesWriteCalled = false;

        const config = new ConnectionConfig(mockVscodeWrapper.object);
        await config.initialized;

        expect(groupsWriteCalled).to.be.false;
        expect(profilesWriteCalled).to.be.false;
    });
});
