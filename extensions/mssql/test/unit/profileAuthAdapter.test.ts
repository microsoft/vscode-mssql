/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { stableProfileId } from "../../src/services/metadata/profileAuthAdapter";

suite("profileAuthAdapter stableProfileId", () => {
    test("a saved id always wins over the derived recipe", () => {
        expect(
            stableProfileId({
                id: "saved-1",
                server: "srv",
                database: "Db",
                authenticationType: "SqlLogin",
            }),
        ).to.equal("saved-1");
    });

    test("derived ids are deterministic and change with every identity field", () => {
        const base = { server: "srv", database: "Db", user: "u", authenticationType: "SqlLogin" };
        expect(stableProfileId(base)).to.equal(stableProfileId({ ...base }));
        expect(stableProfileId({ ...base, database: "Other" })).to.not.equal(stableProfileId(base));
        expect(stableProfileId({ ...base, user: "v" })).to.not.equal(stableProfileId(base));
        expect(stableProfileId({ ...base, authenticationType: "Integrated" })).to.not.equal(
            stableProfileId(base),
        );
    });

    test("field boundaries are unambiguous: separator characters inside fields never collide", () => {
        // A positional "|" join would derive the same id for both of these.
        const shiftedDatabase = stableProfileId({
            server: "srv",
            database: "a|b",
            user: "c",
            authenticationType: "SqlLogin",
        });
        const shiftedUser = stableProfileId({
            server: "srv",
            database: "a",
            user: "b|c",
            authenticationType: "SqlLogin",
        });
        expect(shiftedDatabase).to.not.equal(shiftedUser);
    });
});
