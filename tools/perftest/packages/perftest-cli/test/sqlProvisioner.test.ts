/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import {
    createExternalConnectionProfile,
    parseSqlConnectionString,
} from "../src/sql/sqlProvisioner";

describe("external SQL profile provisioning", () => {
    const connection =
        "Server=example.database.windows.net;Database=SpatialLab;User ID=tester;Password=secret;Encrypt=true";

    it("uses the connection-string database when seed mutation is disabled", () => {
        expect(createExternalConnectionProfile(connection, false)).toMatchObject({
            server: "example.database.windows.net",
            database: "SpatialLab",
            authenticationType: "SqlLogin",
            user: "tester",
            password: "secret",
            encrypt: "true",
        });
    });

    it("targets PerfHarness only when the deterministic seed is enabled", () => {
        expect(createExternalConnectionProfile(connection, true).database).toBe("PerfHarness");
    });

    it("falls back to master for an unseeded profile without a database", () => {
        expect(
            createExternalConnectionProfile("Server=localhost;Integrated Security=true", false),
        ).toMatchObject({ database: "master", authenticationType: "Integrated" });
    });

    it("parses quoted and brace-delimited values containing semicolons and equals signs", () => {
        expect(
            parseSqlConnectionString(
                "Server=localhost;User ID=tester;Password='a;b=c';Database=PerfHarness",
            ).password,
        ).toBe("a;b=c");
        expect(
            parseSqlConnectionString(
                'Server=localhost;User ID=tester;Password="a;""b=c";Database=PerfHarness',
            ).password,
        ).toBe('a;"b=c');
        expect(
            parseSqlConnectionString(
                "Server=localhost;User ID=tester;Password={a;b=c}}d};Database=PerfHarness",
            ).password,
        ).toBe("a;b=c}d");
    });

    it("rejects unterminated quoted values with an actionable error", () => {
        expect(() => parseSqlConnectionString("Server=localhost;Password='unterminated")).toThrow(
            /closing quote/,
        );
    });
});
