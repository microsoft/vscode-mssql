/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { ObjectExplorerUtils } from "../../src/objectExplorer/objectExplorerUtils";
import { expect } from "chai";
import * as Constants from "../../src/constants/constants";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { ObjectMetadata, MetadataType } from "vscode-mssql";
import * as vscode from "vscode";
import { IConnectionProfile } from "../../src/models/interfaces";
import * as sinon from "sinon";
import { initializeIconUtils } from "./utils";

suite("Object Explorer Utils Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        initializeIconUtils();
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Test iconPath function", () => {
        const testObjects = ["Server", "Table", "StoredProcedure"];
        const expectedPaths = ["Server.svg", "Table.svg", "StoredProcedure.svg"];
        for (let i = 0; i < testObjects.length; i++) {
            const iconPath = ObjectExplorerUtils.iconPath(testObjects[i]);
            const fileName = path.basename(iconPath.fsPath);
            expect(fileName, "File name should be the same as expected file name").is.equal(
                expectedPaths[i],
            );
        }
    });

    test("Test getNodeUri function", () => {
        const disconnectedProfile = new ConnectionProfile();
        disconnectedProfile.server = "disconnected_server";
        const testProfile = new ConnectionProfile();
        testProfile.server = "test_server";
        testProfile.profileName = "test_profile";
        testProfile.database = "test_database";
        testProfile.user = "test_user";
        testProfile.authenticationType = Constants.sqlAuthentication;
        const disconnectedTestNode = new TreeNodeInfo(
            "disconnectedTest",
            undefined,
            undefined,
            undefined,
            undefined,
            "disconnectedServer",
            undefined,
            disconnectedProfile,
            undefined,
            undefined,
            undefined,
        );
        const serverTestNode = new TreeNodeInfo(
            "serverTest",
            undefined,
            undefined,
            "test_path",
            undefined,
            "Server",
            undefined,
            testProfile,
            undefined,
            undefined,
            undefined,
        );
        const databaseTestNode = new TreeNodeInfo(
            "databaseTest",
            undefined,
            undefined,
            "test_path",
            undefined,
            "Database",
            undefined,
            testProfile,
            serverTestNode,
            undefined,
            undefined,
        );
        const tableTestNode = new TreeNodeInfo(
            "tableTest",
            undefined,
            undefined,
            "test_path",
            undefined,
            "Table",
            undefined,
            testProfile,
            databaseTestNode,
            undefined,
            undefined,
        );
        const testNodes = [disconnectedTestNode, serverTestNode, tableTestNode];
        const expectedUris = [
            "disconnected_server_undefined_undefined",
            "test_server_test_database_test_user_test_profile",
            "test_server_test_database_test_user_test_profile",
        ];

        for (let i = 0; i < testNodes.length; i++) {
            const nodeUri = ObjectExplorerUtils.getNodeUri(testNodes[i]);
            expect(nodeUri, "Node URI should be the same as expected Node URI").is.equal(
                expectedUris[i],
            );
        }
    });

    test("Test getNodeUriFromProfile", () => {
        const testProfile = new ConnectionProfile();
        testProfile.server = "test_server";
        testProfile.profileName = "test_profile";
        testProfile.database = "test_database";
        testProfile.user = "test_user";
        testProfile.authenticationType = Constants.sqlAuthentication;
        const testProfile2 = new ConnectionProfile();
        testProfile2.server = "test_server2";
        testProfile2.profileName = undefined;
        testProfile2.authenticationType = "Integrated";
        const testProfiles = [testProfile, testProfile2];
        const expectedProfiles = [
            "test_server_test_database_test_user_test_profile",
            "test_server2_undefined_undefined",
        ];

        for (let i = 0; i < testProfiles.length; i++) {
            const uri = ObjectExplorerUtils.getNodeUriFromProfile(testProfiles[i]);
            expect(uri, "Node URI should be the same as expected Node URI").is.equal(
                expectedProfiles[i],
            );
        }
    });

    test("should return empty string if profile is undefined", () => {
        // Setup
        const treeNode = new TreeNodeInfo(
            "label",
            { type: "type", subType: "", filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
        );

        // Execute
        const result = ObjectExplorerUtils.getNodeUri(treeNode);

        // Verify
        expect(result).to.equal("");
    });

    test("should get URI from TreeNodeInfo", () => {
        // Setup
        const profile = {
            server: "testServer",
            database: "testDB",
            authenticationType: Constants.sqlAuthentication,
            user: "testUser",
            profileName: "testProfile",
            id: "id",
        } as IConnectionProfile;
        const treeNode = new TreeNodeInfo(
            "label",
            { type: "type", subType: "", filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            undefined,
            undefined,
            profile,
            undefined,
            undefined,
            undefined,
            undefined,
        );

        const getNodeUriFromProfileStub = sandbox
            .stub(ObjectExplorerUtils, "getNodeUriFromProfile")
            .returns("testUri");

        // Execute
        const result = ObjectExplorerUtils.getNodeUri(treeNode);

        // Verify
        expect(getNodeUriFromProfileStub.calledOnceWith(profile)).to.be.true;
        expect(result).to.equal("testUri");
    });

    test("should get URI from parent node", () => {
        // Setup
        const profile: IConnectionProfile = {
            server: "testServer",
            database: "testDB",
            authenticationType: Constants.sqlAuthentication,
            user: "testUser",
            profileName: "testProfile",
            id: "id",
        } as IConnectionProfile;

        const parentNode = new TreeNodeInfo(
            "parent",
            { type: "parentType", subType: "", filterable: false, hasFilters: false },
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            undefined,
            undefined,
            profile,
            undefined,
            undefined,
            undefined,
        );

        // Create a mock node that is not TreeNodeInfo but has a parentNode property
        const mockNode = {
            parentNode: parentNode,
        } as any; // Using 'as any' to bypass TypeScript's type checking

        const getNodeUriFromProfileStub = sandbox
            .stub(ObjectExplorerUtils, "getNodeUriFromProfile")
            .returns("testParentUri");

        // Execute
        const result = ObjectExplorerUtils.getNodeUri(mockNode);

        // Verify
        expect(getNodeUriFromProfileStub.calledOnceWith(profile)).to.be.true;
        expect(result).to.equal("testParentUri");
    });

    test("should return connection string without password if present", () => {
        // Setup
        const profile: IConnectionProfile = {
            connectionString: "Server=myServer;Database=myDb;User Id=myUser;Password=myPassword;",
            server: "server",
            database: "database",
            authenticationType: Constants.sqlAuthentication,
            user: "user",
            profileName: "profile",
            id: "id",
        } as IConnectionProfile;

        // Execute
        const result = ObjectExplorerUtils.getNodeUriFromProfile(profile);

        // Verify - should include all parts except the password
        expect(result).to.equal("Server=myServer;Database=myDb;User Id=myUser;");
    });

    test("should create URI for SQL authentication without connection string", () => {
        // Setup
        const profile: IConnectionProfile = {
            server: "testServer",
            database: "testDB",
            authenticationType: Constants.sqlAuthentication,
            user: "testUser",
            profileName: "testProfile",
            id: "id",
        } as IConnectionProfile;

        // Execute
        const result = ObjectExplorerUtils.getNodeUriFromProfile(profile);

        // Verify
        expect(result).to.equal("testServer_testDB_testUser_testProfile");
    });

    test("should create URI for Windows authentication without connection string", () => {
        // Setup
        const profile: IConnectionProfile = {
            server: "testServer",
            database: "testDB",
            authenticationType: "Windows Authentication", // Not SQL auth
            profileName: "testProfile",
            id: "id",
        } as IConnectionProfile;

        // Execute
        const result = ObjectExplorerUtils.getNodeUriFromProfile(profile);

        // Verify
        expect(result).to.equal("testServer_testDB_testProfile");
    });

    test("Test getDatabaseName", () => {
        const testProfile = new ConnectionProfile();
        testProfile.server = "test_server";
        testProfile.profileName = "test_profile";
        testProfile.database = "test_database";
        testProfile.user = "test_user";
        const serverTestNode = new TreeNodeInfo(
            "serverTest",
            undefined,
            undefined,
            "test_path",
            undefined,
            "Server",
            undefined,
            testProfile,
            undefined,
            undefined,
            undefined,
        );
        let databaseMetatadata: ObjectMetadata = {
            metadataType: undefined,
            metadataTypeName: Constants.databaseString,
            urn: undefined,
            name: "databaseTest",
            schema: undefined,
        };
        const databaseTestNode = new TreeNodeInfo(
            "databaseTest",
            undefined,
            undefined,
            "test_path",
            undefined,
            "Database",
            undefined,
            undefined,
            serverTestNode,
            undefined,
            undefined,
            databaseMetatadata,
        );
        const databaseTestNode2 = new TreeNodeInfo(
            "databaseTest",
            undefined,
            undefined,
            "test_path",
            undefined,
            "Database",
            undefined,
            undefined,
            serverTestNode,
            undefined,
            undefined,
        );
        const tableTestNode = new TreeNodeInfo(
            "tableTest",
            undefined,
            undefined,
            "test_path",
            undefined,
            "Table",
            undefined,
            undefined,
            databaseTestNode,
            undefined,
            undefined,
        );
        const testNodes = [serverTestNode, databaseTestNode, databaseTestNode2, tableTestNode];
        const expectedDatabaseNames = [
            "test_database",
            "databaseTest",
            "<default>",
            "databaseTest",
        ];
        for (let i = 0; i < testNodes.length; i++) {
            let databaseName = ObjectExplorerUtils.getDatabaseName(testNodes[i]);
            expect(databaseName).to.equal(expectedDatabaseNames[i]);
        }
    });

    test("Test isFirewallError", () => {
        const loginError = 18456;
        expect(
            ObjectExplorerUtils.isFirewallError(loginError),
            "Error should not be a firewall error",
        ).to.not.be.true;
        const firewallError = Constants.errorFirewallRule;
        expect(
            ObjectExplorerUtils.isFirewallError(firewallError),
            "Error should be a firewall error",
        ).to.be.true;
    });

    suite("getQualifiedName Tests", () => {
        test("should return properly formatted qualified name for Table", () => {
            // Setup
            const node = new TreeNodeInfo(
                "CustomersTable",
                { type: "Table", subType: "", filterable: false, hasFilters: false },
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                {
                    metadataTypeName: "Table",
                    name: "Customers",
                    schema: "dbo",
                    metadataType: MetadataType.Table,
                    urn: "",
                } as ObjectMetadata,
            );

            // Execute
            const result = ObjectExplorerUtils.getQualifiedName(node);

            // Verify
            expect(result).to.equal("[dbo].[Customers]");
        });

        test("should return properly formatted qualified name for StoredProcedure", () => {
            // Setup
            const node = new TreeNodeInfo(
                "GetCustomersProc",
                { type: "StoredProcedure", subType: "", filterable: false, hasFilters: false },
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                {
                    metadataTypeName: "StoredProcedure",
                    name: "GetCustomers",
                    schema: "dbo",
                    metadataType: MetadataType.SProc,
                    urn: "",
                } as ObjectMetadata,
            );

            // Execute
            const result = ObjectExplorerUtils.getQualifiedName(node);

            // Verify
            expect(result).to.equal("[dbo].[GetCustomers]");
        });

        test("should return properly formatted qualified name for View", () => {
            // Setup
            const node = new TreeNodeInfo(
                "ActiveCustomersView",
                { type: "View", subType: "", filterable: false, hasFilters: false },
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                {
                    metadataTypeName: "View",
                    name: "ActiveCustomers",
                    schema: "dbo",
                    metadataType: MetadataType.View,
                    urn: "",
                },
            );

            // Execute
            const result = ObjectExplorerUtils.getQualifiedName(node);

            // Verify
            expect(result).to.equal("[dbo].[ActiveCustomers]");
        });

        test("should return properly formatted qualified name for UserDefinedFunction", () => {
            // Setup
            const node = new TreeNodeInfo(
                "CalculateDiscountFunction",
                { type: "UserDefinedFunction", subType: "", filterable: false, hasFilters: false },
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                {
                    metadataTypeName: "UserDefinedFunction",
                    name: "CalculateDiscount",
                    schema: "dbo",
                    metadataType: MetadataType.Function,
                    urn: "",
                },
            );

            // Execute
            const result = ObjectExplorerUtils.getQualifiedName(node);

            // Verify
            expect(result).to.equal("[dbo].[CalculateDiscount]");
        });

        test("should return name with brackets for other metadata types", () => {
            // Setup
            const node = new TreeNodeInfo(
                "master",
                { type: "Database", subType: "", filterable: false, hasFilters: false },
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                {
                    metadataTypeName: "Database",
                    name: "master",
                    schema: "dbo",
                    urn: "",
                } as ObjectMetadata,
            );

            // Execute
            const result = ObjectExplorerUtils.getQualifiedName(node);

            // Verify
            expect(result).to.equal("[master]");
        });

        test("should return empty string if node has no metadata", () => {
            // Setup
            const node = new TreeNodeInfo(
                "label",
                { type: "type", subType: "", filterable: false, hasFilters: false },
                vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
            );

            // Execute
            const result = ObjectExplorerUtils.getQualifiedName(node);

            // Verify
            expect(result).to.equal("");
        });
    });
});
