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
            replication: true,
        };

        const node = new ConnectionNode(profile as any);

        // Tooltip should be a MarkdownString for keyboard accessibility
        expect(node.tooltip).to.be.an("object");
        expect(node.tooltip).to.have.property("value");
        const tooltipValue = (node.tooltip as any).value;

        // Tooltip should include keys that differ from defaults and should include only whitelisted keys
        expect(tooltipValue).to.contain("profileNameValue");
        expect(tooltipValue).to.contain("Server: myServer");
        expect(tooltipValue).to.contain("Database: myDb");
        expect(tooltipValue).to.not.contain("authenticationType: sqlLogin");
        expect(tooltipValue).to.contain("User: myUser");
        expect(tooltipValue).to.contain("Port: 1234");
        expect(tooltipValue).to.not.contain("password");
        expect(tooltipValue).to.not.contain("savePassword: true");
        expect(tooltipValue).to.contain("SQL Container Name: myContainer");
        expect(tooltipValue).to.contain("SQL Container Version: 1.0");
        expect(tooltipValue).to.not.contain("encrypt");
        expect(tooltipValue).to.contain("Application Intent: Read");
        expect(tooltipValue).to.contain("Connection Timeout: 10");
        expect(tooltipValue).to.contain("Command Timeout: 441");
        expect(tooltipValue).to.not.contain("applicationName: MyApp");
        expect(tooltipValue).to.not.contain("profileName:");
        expect(tooltipValue).to.not.contain("groupId:");
        expect(tooltipValue).to.contain("Always Encrypted: Enabled");
        expect(tooltipValue).to.contain("Replication: Enabled");
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

        // Tooltip should be a MarkdownString for keyboard accessibility
        expect(node.tooltip).to.be.an("object");
        expect(node.tooltip).to.have.property("value");
        const tooltipValue = (node.tooltip as any).value;

        // Tooltip should include keys that differ from defaults and should not include 'excluded' keys
        expect(tooltipValue).to.contain("Azure MFA");
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

        // Tooltip should be a MarkdownString for keyboard accessibility
        expect(node.tooltip).to.be.an("object");
        expect(node.tooltip).to.have.property("value");
        const tooltipValue = (node.tooltip as any).value;

        // Tooltip should include keys that differ from defaults and should not include 'excluded' keys
        expect(tooltipValue).to.contain("Windows Authentication");
    });
});
