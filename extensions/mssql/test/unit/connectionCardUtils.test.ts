/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    AuthenticationType,
    IConnectionDialogProfile,
} from "../../src/sharedInterfaces/connectionDialog";
import {
    getConnectionCardKey,
    getConnectionsListKey,
} from "../../src/webviews/pages/ConnectionDialog/connectionCardUtils";

suite("ConnectionCardUtils", () => {
    const baseConnection = {
        id: "profile-1",
        server: "server-a",
        database: "db-a",
        authenticationType: AuthenticationType.SqlLogin,
        profileName: "Saved Profile",
        user: "sa",
    } as IConnectionDialogProfile;

    test("uses different keys for recent entries with the same id but different databases", () => {
        const firstConnection: IConnectionDialogProfile = {
            ...baseConnection,
        };
        const secondConnection: IConnectionDialogProfile = {
            ...baseConnection,
            database: "db-b",
        };

        expect(getConnectionCardKey(firstConnection)).to.not.equal(
            getConnectionCardKey(secondConnection),
        );
    });

    test("uses the same key when the rendered connection identity is unchanged", () => {
        expect(getConnectionCardKey(baseConnection)).to.equal(
            getConnectionCardKey({ ...baseConnection }),
        );
    });

    test("changes the list key when the ordered recent connections change", () => {
        const firstConnection: IConnectionDialogProfile = {
            ...baseConnection,
        };
        const secondConnection: IConnectionDialogProfile = {
            ...baseConnection,
            database: "db-b",
        };

        expect(getConnectionsListKey([firstConnection, secondConnection])).to.not.equal(
            getConnectionsListKey([secondConnection, firstConnection]),
        );
    });
});
