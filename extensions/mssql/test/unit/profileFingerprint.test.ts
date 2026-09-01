/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    profileFingerprint,
    serverFingerprint,
} from "../../src/services/metadata/profileFingerprint";

suite("profileFingerprint canonical encoding", () => {
    test("field boundaries are unambiguous: separator characters inside fields never collide", () => {
        // A positional "|" join would hash ["s", "a|b", "c"] and ["s", "a", "b|c"] identically.
        const shiftedDatabase = profileFingerprint({
            server: "srv",
            database: "a|b",
            user: "c",
            authKind: "sql",
        });
        const shiftedUser = profileFingerprint({
            server: "srv",
            database: "a",
            user: "b|c",
            authKind: "sql",
        });
        expect(shiftedDatabase).to.not.equal(shiftedUser);

        // Same shape for the server-scoped key: an empty user must not absorb a
        // separator that lives inside the server name.
        const serverWithSeparator = serverFingerprint({ server: "s|u", user: "", authKind: "sql" });
        const splitServerUser = serverFingerprint({ server: "s", user: "u", authKind: "sql" });
        expect(serverWithSeparator).to.not.equal(splitServerUser);
    });

    test("shape and determinism: prefix + 22 base64url chars, stable across calls", () => {
        const input = { server: "srv", database: "Db", user: "u", authKind: "sql" };
        expect(profileFingerprint(input)).to.match(/^pfp_[A-Za-z0-9_-]{22}$/);
        expect(serverFingerprint(input)).to.match(/^sfp_[A-Za-z0-9_-]{22}$/);
        expect(profileFingerprint(input)).to.equal(profileFingerprint({ ...input }));
        // Undefined and empty are the same absent value; the database is not part of the server key.
        expect(serverFingerprint({ ...input, database: undefined })).to.equal(
            serverFingerprint({ ...input, database: "" }),
        );
        expect(profileFingerprint({ ...input, database: "Other" })).to.not.equal(
            profileFingerprint(input),
        );
    });
});
