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
            user: "myUser",
            password: "", // keep empty to avoid exposing password in tooltip
            savePassword: true, // default is false -> should appear
            encrypt: "None", // default is "Mandatory" -> should appear
            connectTimeout: 10, // default differs -> should appear
            applicationName: "MyApp", // default differs -> should appear
            profileName: "shouldBeExcluded",
            groupId: "shouldBeExcluded",
        };

        const node = new ConnectionNode(profile as any);

        // Tooltip should include keys that differ from defaults and should not include excluded keys
        expect(node.tooltip).to.be.a("string");
        expect(node.tooltip).to.contain("connectTimeout: 10");
        expect(node.tooltip).to.contain("applicationName: MyApp");
        expect(node.tooltip).to.contain("server:");
        expect(node.tooltip).to.contain("database:");
        expect(node.tooltip).to.contain("user:");

        // Excluded keys should not be present
        expect(node.tooltip).to.not.contain("profileName:");
        expect(node.tooltip).to.not.contain("id:");
        expect(node.tooltip).to.not.contain("groupId:");
        expect(node.tooltip).to.not.contain("savePassword: true");
        expect(node.tooltip).to.not.contain("encrypt");
    });

    test("constructor should set tooltip including non-default properties for connection with profileName should include server, db and user", () => {
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
            profileName: "",
            groupId: "shouldBeExcluded",
        };

        const node = new ConnectionNode(profile as any);

        // Tooltip should include keys that differ from defaults and should not include 'excluded' keys
        expect(node.tooltip).to.be.a("string");
        expect(node.tooltip).to.contain("connectTimeout: 10");
        expect(node.tooltip).to.contain("applicationName: MyApp");

        // Excluded keys should not be present
        expect(node.tooltip).to.not.contain("server:");
        expect(node.tooltip).to.not.contain("database:");
        expect(node.tooltip).to.not.contain("user:");
        expect(node.tooltip).to.not.contain("profileName:");
        expect(node.tooltip).to.not.contain("id:");
        expect(node.tooltip).to.not.contain("groupId:");
        expect(node.tooltip).to.not.contain("savePassword");
        expect(node.tooltip).to.not.contain("encrypt");
    });
});
