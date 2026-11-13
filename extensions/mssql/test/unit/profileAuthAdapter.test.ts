/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { prepareConnection, stableProfileId } from "../../src/services/metadata/profileAuthAdapter";

suite("profileAuthAdapter SQL credentials", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    test("honors an explicit profile password without putting it in connection metadata", async () => {
        const lookupPassword = sandbox.stub().resolves("saved-secret");
        const prepared = prepareConnection(
            {
                server: "test",
                user: "test-user",
                authenticationType: "SqlLogin",
                password: "inline-secret-canary",
                savePassword: false,
            },
            { lookupPassword },
        );
        expect(await prepared.auth.passwordProvider!()).to.equal("inline-secret-canary");
        sinon.assert.notCalled(lookupPassword);
        expect(JSON.stringify(prepared)).not.to.contain("inline-secret-canary");
    });

    test("defers saved-password lookup until open when no explicit password was supplied", async () => {
        const lookupPassword = sandbox.stub().resolves("saved-secret");
        const profile = { server: "test", authenticationType: "SqlLogin", password: "" };
        const prepared = prepareConnection(profile, { lookupPassword });
        sinon.assert.notCalled(lookupPassword);
        expect(await prepared.auth.passwordProvider!()).to.equal("saved-secret");
        sinon.assert.calledWith(lookupPassword, profile);
        expect(JSON.stringify(prepared)).not.to.contain("saved-secret");
    });
});

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
