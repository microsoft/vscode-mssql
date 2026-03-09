/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { stripEntraAuthPropertiesFromConnectionString } from "../../src/flatFile/flatFileUtils";

suite("stripEntraAuthPropertiesFromConnectionString", () => {
    test("removes User ID property", () => {
        const input = "Server=myserver;User ID=myuser;Database=mydb";
        const result = stripEntraAuthPropertiesFromConnectionString(input);
        expect(result).to.equal("Server=myserver;Database=mydb");
    });

    test("removes UID property", () => {
        const input = "Server=myserver;UID=myuser;Database=mydb";
        const result = stripEntraAuthPropertiesFromConnectionString(input);
        expect(result).to.equal("Server=myserver;Database=mydb");
    });

    test("removes Password property", () => {
        const input = "Server=myserver;Password=secret;Database=mydb";
        const result = stripEntraAuthPropertiesFromConnectionString(input);
        expect(result).to.equal("Server=myserver;Database=mydb");
    });

    test("removes PWD property", () => {
        const input = "Server=myserver;PWD=secret;Database=mydb";
        const result = stripEntraAuthPropertiesFromConnectionString(input);
        expect(result).to.equal("Server=myserver;Database=mydb");
    });

    test("removes Authentication property", () => {
        const input = "Server=myserver;Authentication=ActiveDirectoryInteractive;Database=mydb";
        const result = stripEntraAuthPropertiesFromConnectionString(input);
        expect(result).to.equal("Server=myserver;Database=mydb");
    });

    test("removes multiple conflicting properties at once", () => {
        const input =
            "Server=myserver;User ID=myuser;Password=secret;Authentication=ActiveDirectoryInteractive;Database=mydb";
        const result = stripEntraAuthPropertiesFromConnectionString(input);
        expect(result).to.equal("Server=myserver;Database=mydb");
    });

    test("is case-insensitive for property names", () => {
        const input =
            "Server=myserver;USER ID=myuser;PASSWORD=secret;AUTHENTICATION=ActiveDirectoryMFA;Database=mydb";
        const result = stripEntraAuthPropertiesFromConnectionString(input);
        expect(result).to.equal("Server=myserver;Database=mydb");
    });

    test("returns connection string unchanged when no auth properties are present", () => {
        const input = "Server=myserver;Database=mydb;Encrypt=True;TrustServerCertificate=False";
        const result = stripEntraAuthPropertiesFromConnectionString(input);
        expect(result).to.equal(input);
    });

    test("returns empty string unchanged", () => {
        const result = stripEntraAuthPropertiesFromConnectionString("");
        expect(result).to.equal("");
    });

    test("returns undefined unchanged", () => {
        const result = stripEntraAuthPropertiesFromConnectionString(undefined);
        expect(result).to.be.undefined;
    });
});
