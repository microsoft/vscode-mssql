/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the connection-string helpers (Scope 2). sqlpackage requires the
 * target database inside the connection string, so `ensureDatabaseInConnectionString`
 * appends it when absent and leaves an existing catalog untouched, while
 * `withDatabaseInConnectionString` OVERRIDES an existing catalog (the connection
 * runtime host re-targets a saved string at the throwaway database / `master`).
 */

import { expect } from "chai";

import {
    ensureDatabaseInConnectionString,
    withDatabaseInConnectionString,
} from "../../src/cloudDeploy/host/connectionStringUtils";

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

suite("CloudDeploy withDatabaseInConnectionString", () => {
    test("replaces an existing Database= value in place", () => {
        const result = withDatabaseInConnectionString(
            "Server=localhost;Database=Existing;User ID=sa",
            "MyDb",
        );
        expect(result).to.equal("Server=localhost;Database=MyDb;User ID=sa");
    });

    test("replaces an existing Initial Catalog= value in place", () => {
        const result = withDatabaseInConnectionString(
            "Data Source=localhost;Initial Catalog=Existing;User ID=sa",
            "MyDb",
        );
        expect(result).to.equal("Data Source=localhost;Initial Catalog=MyDb;User ID=sa");
    });

    test("preserves the original keyword casing when replacing", () => {
        const result = withDatabaseInConnectionString("Server=localhost;DATABASE=Existing", "MyDb");
        expect(result).to.equal("Server=localhost;DATABASE=MyDb");
    });

    test("preserves whitespace around the keyword when replacing", () => {
        const result = withDatabaseInConnectionString(
            "Server=localhost; Database =Existing",
            "MyDb",
        );
        expect(result).to.equal("Server=localhost; Database =MyDb");
    });

    test("appends Database when no catalog keyword is present", () => {
        const result = withDatabaseInConnectionString(
            "Server=localhost,14333;User ID=sa;Password=pw",
            "MyDb",
        );
        expect(result).to.equal("Server=localhost,14333;User ID=sa;Password=pw;Database=MyDb");
    });

    test("does not add a second separator when the string ends with one", () => {
        const result = withDatabaseInConnectionString("Server=localhost;", "MyDb");
        expect(result).to.equal("Server=localhost;Database=MyDb");
    });

    test("does not treat the word 'database' inside another value as the keyword", () => {
        // The boundary-anchored check must not clobber a password that merely
        // contains the substring 'database'; the catalog is appended instead.
        const result = withDatabaseInConnectionString(
            "Server=localhost;Password=mydatabasepw;User ID=sa",
            "MyDb",
        );
        expect(result).to.equal("Server=localhost;Password=mydatabasepw;User ID=sa;Database=MyDb");
    });
});
