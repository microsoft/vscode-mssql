/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `ensureDatabaseInConnectionString` (Scope 2): sqlpackage requires
 * the target database inside the connection string, so the helper appends it
 * when absent and leaves an existing catalog untouched.
 */

import { expect } from "chai";

import { ensureDatabaseInConnectionString } from "../../src/cloudDeploy/host/connectionStringUtils";

suite("CloudDeploy ensureDatabaseInConnectionString", () => {
    test("appends Database when no catalog keyword is present", () => {
        const result = ensureDatabaseInConnectionString(
            "Server=localhost,14333;User ID=sa;Password=pw",
            "MyDb",
        );
        expect(result).to.equal("Server=localhost,14333;User ID=sa;Password=pw;Database=MyDb");
    });

    test("does not duplicate when Database= is already present", () => {
        const input = "Server=localhost;Database=Existing;User ID=sa";
        expect(ensureDatabaseInConnectionString(input, "MyDb")).to.equal(input);
    });

    test("does not duplicate when Initial Catalog= is already present", () => {
        const input = "Data Source=localhost;Initial Catalog=Existing;User ID=sa";
        expect(ensureDatabaseInConnectionString(input, "MyDb")).to.equal(input);
    });

    test("is case-insensitive about the existing catalog keyword", () => {
        const input = "Server=localhost;DATABASE=Existing";
        expect(ensureDatabaseInConnectionString(input, "MyDb")).to.equal(input);
    });

    test("returns the string unchanged when the database is undefined", () => {
        const input = "Server=localhost;User ID=sa";
        expect(ensureDatabaseInConnectionString(input, undefined)).to.equal(input);
    });

    test("returns the string unchanged when the database is empty", () => {
        const input = "Server=localhost;User ID=sa";
        expect(ensureDatabaseInConnectionString(input, "")).to.equal(input);
    });

    test("does not add a second separator when the string ends with one", () => {
        const result = ensureDatabaseInConnectionString("Server=localhost;", "MyDb");
        expect(result).to.equal("Server=localhost;Database=MyDb");
    });

    test("does not treat the word 'database' inside another value as the keyword", () => {
        // A password that merely contains the substring 'database' must not be
        // mistaken for a Database keyword (the check is boundary-anchored).
        const result = ensureDatabaseInConnectionString(
            "Server=localhost;User ID=sa;Password=mydatabasepw",
            "MyDb",
        );
        expect(result).to.equal("Server=localhost;User ID=sa;Password=mydatabasepw;Database=MyDb");
    });
});
