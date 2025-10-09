/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { ObjectExplorerUtils } from "../../src/objectExplorer/objectExplorerUtils";

suite("ConnectionNode Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        // Stub iconPath so tests don't depend on actual resources
        sandbox.stub(ObjectExplorerUtils, "iconPath").callsFake((_: string) => undefined);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("constructor should set tooltip including non-default properties and excluding label keys", () => {
        const profile: any = {
            id: "1",
            server: "myServer",
            database: "myDb",
            authenticationType: "sqlLogin",
            user: "myUser",
            port: 1234,
            password: "blah",
            savePassword: true,
            containerName: "myContainer",
            version: "1.0",
            encrypt: "None",
            applicationIntent: "Read",
            connectTimeout: 10,
            commandTimeout: 441,
            applicationName: "MyApp",
            profileName: "profileNameValue",
            groupId: "shouldBeExcluded",
            alwaysEncrypted: true,
            email: "email@example.com",
            replication: "enabled",
        };

        const node = new ConnectionNode(profile as any);

        // Tooltip should include keys that differ from defaults and should include only whitelisted keys
        expect(node.tooltip).to.be.a("string");
        expect(node.tooltip).to.contain("profileNameValue");
        expect(node.tooltip).to.contain("Server: myServer");
        expect(node.tooltip).to.contain("Database: myDb");
        expect(node.tooltip).to.not.contain("authenticationType: sqlLogin");
        expect(node.tooltip).to.contain("User: myUser");
        expect(node.tooltip).to.contain("Port: 1234");
        expect(node.tooltip).to.not.contain("password");
        expect(node.tooltip).to.not.contain("savePassword: true");
        expect(node.tooltip).to.contain("SQL Container Name: myContainer");
        expect(node.tooltip).to.contain("SQL Container Version: 1.0");
        expect(node.tooltip).to.not.contain("encrypt");
        expect(node.tooltip).to.contain("Application Intent: Read");
        expect(node.tooltip).to.contain("Connection Timeout: 10");
        expect(node.tooltip).to.contain("Command Timeout: 441");
        expect(node.tooltip).to.not.contain("applicationName: MyApp");
        expect(node.tooltip).to.not.contain("profileName:");
        expect(node.tooltip).to.not.contain("groupId:");
        expect(node.tooltip).to.contain("Always Encrypted: true");
        expect(node.tooltip).to.contain("Replication: enabled");
    });

    test("constructor should set tooltip including labels for auth type MFA", () => {
        const profile: any = {
            id: "1",
            server: "myServer",
            database: "myDb",
            user: "myUser",
            password: "", // keep empty to avoid exposing password in tooltip
            savePassword: true, // default is false -> should appear
            encrypt: "None", // default is "Mandatory" -> should appear
            connectTimeout: 10, // default differs -> should appear
            applicationName: "MyApp", // default differs -> should appear
            profileName: "profileNameValue",
            groupId: "shouldBeExcluded",
            email: "email@example.com",
            authenticationType: "AzureMFA",
        };

        const node = new ConnectionNode(profile as any);

        // Tooltip should include keys that differ from defaults and should not include 'excluded' keys
        expect(node.tooltip).to.be.a("string");
        expect(node.tooltip).to.contain("Azure MFA");
    });

    test("constructor should set tooltip including labels for auth type integrated windows auth", () => {
        const profile: any = {
            id: "1",
            server: "myServer",
            database: "myDb",
            user: "myUser",
            password: "", // keep empty to avoid exposing password in tooltip
            savePassword: true, // default is false -> should appear
            encrypt: "None", // default is "Mandatory" -> should appear
            connectTimeout: 10, // default differs -> should appear
            applicationName: "MyApp", // default differs -> should appear
            profileName: "profileNameValue",
            groupId: "shouldBeExcluded",
            email: "email@example.com",
            authenticationType: "Integrated",
        };

        const node = new ConnectionNode(profile as any);

        // Tooltip should include keys that differ from defaults and should not include 'excluded' keys
        expect(node.tooltip).to.be.a("string");
        expect(node.tooltip).to.contain("Windows Authentication");
    });
});
