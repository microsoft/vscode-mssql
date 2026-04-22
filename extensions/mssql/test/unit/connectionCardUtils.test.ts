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
    const baseConnection: IConnectionDialogProfile = {
        id: "profile-1",
        server: "server-a",
        database: "db-a",
        authenticationType: AuthenticationType.SqlLogin,
        profileName: "Saved Profile",
        user: "sa",
    };

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

    test("redacts secret connection string values from keys", () => {
        const firstConnection: IConnectionDialogProfile = {
            ...baseConnection,
            connectionString:
                "Server=server-a;Database=db-a;Password=supersecret;Access Token=token-one;Encrypt=True;",
        };
        const secondConnection: IConnectionDialogProfile = {
            ...baseConnection,
            connectionString:
                "Server=server-a;Database=db-a;Password=anothersecret;Access Token=token-two;Encrypt=True;",
        };

        const firstKey = getConnectionCardKey(firstConnection);
        const secondKey = getConnectionCardKey(secondConnection);

        expect(firstKey).to.equal(secondKey);
        expect(firstKey).to.contain("Password=<redacted>");
        expect(firstKey).to.contain("Access Token=<redacted>");
        expect(firstKey).to.not.contain("supersecret");
        expect(firstKey).to.not.contain("token-one");
    });

    test("keeps non-secret connection string differences in keys", () => {
        const firstConnection: IConnectionDialogProfile = {
            ...baseConnection,
            connectionString: "Server=server-a;Database=db-a;Encrypt=True;",
        };
        const secondConnection: IConnectionDialogProfile = {
            ...baseConnection,
            connectionString: "Server=server-a;Database=db-a;Encrypt=False;",
        };

        expect(getConnectionCardKey(firstConnection)).to.not.equal(
            getConnectionCardKey(secondConnection),
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
