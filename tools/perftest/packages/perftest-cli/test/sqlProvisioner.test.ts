import { describe, expect, it } from "vitest";
import { createExternalConnectionProfile } from "../src/sql/sqlProvisioner";

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
});
