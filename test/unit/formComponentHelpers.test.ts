/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { completeFormComponents } from "../../src/connectionconfig/formComponentHelpers";

import { expect } from "chai";
import {
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../src/sharedInterfaces/connectionDialog";
import { ConnectionDialog } from "../../src/constants/locConstants";

suite("completeFormComponents tests", () => {
    let components: Partial<Record<keyof IConnectionDialogProfile, ConnectionDialogFormItemSpec>> =
        {};

    setup(() => {
        components = {
            server: {
                isAdvancedOption: false,
                type: undefined,
                propertyName: "profileName",
                label: "",
                required: false,
            },
            user: {
                isAdvancedOption: false,
                type: undefined,
                propertyName: "profileName",
                label: "",
                required: false,
            },
        };
    });

    test("should validate profileName for duplicates", async () => {
        await completeFormComponents(components, undefined, undefined, undefined);

        const state: ConnectionDialogWebviewState = {
            savedConnections: [
                {
                    profileName: "TestProfile",
                    server: "server1",
                    database: "db1",
                    user: "user1",
                    id: "id1",
                },
            ],
            connectionProfile: {
                profileName: "TestProfile",
                server: "server1",
                database: "db1",
                user: "user1",
                id: "id2",
            },
        } as any;

        const result = components.profileName.validate(state, "TestProfile");
        expect(result.isValid).to.be.false;
        expect(result.validationMessage).to.equal(ConnectionDialog.profileNameAlreadyInUse);
    });

    test("should pass validation on editing connections", async () => {
        await completeFormComponents(components, undefined, undefined, undefined);

        const state: ConnectionDialogWebviewState = {
            savedConnections: [
                {
                    profileName: "TestProfile",
                    server: "server1",
                    database: "db1",
                    user: "user1",
                    id: "id1",
                },
            ],
            connectionProfile: {
                profileName: "TestProfile",
                server: "server1",
                database: "db1",
                user: "user1",
                id: "id1",
            },
        } as any;

        const result = components.profileName.validate(state, "TestProfile");
        expect(result.isValid).to.be.true;
        expect(result.validationMessage).to.equal("");
    });

    test("should pass validation on adding connections for different server", async () => {
        await completeFormComponents(components, undefined, undefined, undefined);

        const state: ConnectionDialogWebviewState = {
            savedConnections: [
                {
                    profileName: "TestProfile",
                    server: "server1",
                    database: "db1",
                    user: "user1",
                    id: "id1",
                },
            ],
            connectionProfile: {
                profileName: "TestProfile",
                server: "server2",
                database: "db1",
                user: "user1",
                id: "id1",
            },
        } as any;

        const result = components.profileName.validate(state, "TestProfile");
        expect(result.isValid).to.be.true;
        expect(result.validationMessage).to.equal("");
    });

    test("should pass validation on adding connections for different database", async () => {
        await completeFormComponents(components, undefined, undefined, undefined);

        const state: ConnectionDialogWebviewState = {
            savedConnections: [
                {
                    profileName: "TestProfile",
                    server: "server1",
                    database: "db1",
                    user: "user1",
                    id: "id1",
                },
            ],
            connectionProfile: {
                profileName: "TestProfile",
                server: "server1",
                database: "db2",
                user: "user1",
                id: "id1",
            },
        } as any;

        const result = components.profileName.validate(state, "TestProfile");
        expect(result.isValid).to.be.true;
        expect(result.validationMessage).to.equal("");
    });

    test("should pass validation on adding connections for different user", async () => {
        await completeFormComponents(components, undefined, undefined, undefined);

        const state: ConnectionDialogWebviewState = {
            savedConnections: [
                {
                    profileName: "TestProfile",
                    server: "server1",
                    database: "db1",
                    user: "user1",
                    id: "id1",
                },
            ],
            connectionProfile: {
                profileName: "TestProfile",
                server: "server1",
                database: "db1",
                user: "user2",
                id: "id1",
            },
        } as any;

        const result = components.profileName.validate(state, "TestProfile");
        expect(result.isValid).to.be.true;
        expect(result.validationMessage).to.equal("");
    });

    test("should pass validation on adding connections for different profile name", async () => {
        await completeFormComponents(components, undefined, undefined, undefined);

        const state: ConnectionDialogWebviewState = {
            savedConnections: [
                {
                    profileName: "TestProfile",
                    server: "server1",
                    database: "db1",
                    user: "user1",
                    id: "id1",
                },
            ],
            connectionProfile: {
                profileName: "TestProfile2",
                server: "server1",
                database: "db1",
                user: "user1",
                id: "id1",
            },
        } as any;

        const result = components.profileName.validate(state, "TestProfile");
        expect(result.isValid).to.be.true;
        expect(result.validationMessage).to.equal("");
    });

    test("should fail validation on adding connections for blank profile name when the server, db and user are the same of a saved connection", async () => {
        await completeFormComponents(components, undefined, undefined, undefined);

        const state: ConnectionDialogWebviewState = {
            savedConnections: [
                {
                    profileName: "",
                    server: "server1",
                    database: "db1",
                    user: "user1",
                    id: "id1",
                },
            ],
            connectionProfile: {
                profileName: "",
                server: "server1",
                database: "db1",
                user: "user1",
                id: "",
            },
        } as any;

        const result = components.profileName.validate(state, "");
        expect(result.isValid).to.be.false;
        expect(result.validationMessage).to.equal(ConnectionDialog.profileNameTipAdd);
    });
});
