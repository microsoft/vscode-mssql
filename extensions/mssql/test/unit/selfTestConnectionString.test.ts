/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Self-test env-var connection-string parsing + redaction: the parser must
 * handle ADO.NET shapes, fail actionably, and the display label must never
 * contain credentials.
 */

import { expect } from "chai";
import {
    connectionStringLabel,
    parseSqlConnectionString,
} from "../../src/diagnostics/selfTest/connectionString";
import { selfTestAuthenticationType } from "../../src/diagnostics/selfTest/selfTestService";

suite("Self-test connection string parsing", () => {
    test("self-test auth mapping is exhaustive and never coerces Entra to Integrated", () => {
        expect(selfTestAuthenticationType(undefined)).to.equal("SqlLogin");
        expect(selfTestAuthenticationType("SqlLogin")).to.equal("SqlLogin");
        expect(selfTestAuthenticationType("Integrated")).to.equal("Integrated");
        expect(selfTestAuthenticationType("AzureMFA")).to.equal(undefined);
        expect(selfTestAuthenticationType("ActiveDirectoryDefault")).to.equal(undefined);
    });

    test("parses a standard SQL-login connection string", () => {
        const outcome = parseSqlConnectionString(
            "Server=tcp:myserver,1433;Database=mydb;User ID=sa;Password=P@ss;Encrypt=True;TrustServerCertificate=True",
        );
        expect("parsed" in outcome).to.equal(true);
        if ("parsed" in outcome) {
            expect(outcome.parsed.server).to.equal("tcp:myserver,1433");
            expect(outcome.parsed.database).to.equal("mydb");
            expect(outcome.parsed.user).to.equal("sa");
            expect(outcome.parsed.password).to.equal("P@ss");
            expect(outcome.parsed.integrated).to.equal(false);
            expect(outcome.parsed.trustServerCertificate).to.equal(true);
        }
    });

    test("parses integrated security and key aliases", () => {
        const outcome = parseSqlConnectionString(
            "Data Source=localhost;Initial Catalog=master;Integrated Security=SSPI",
        );
        expect("parsed" in outcome).to.equal(true);
        if ("parsed" in outcome) {
            expect(outcome.parsed.server).to.equal("localhost");
            expect(outcome.parsed.database).to.equal("master");
            expect(outcome.parsed.integrated).to.equal(true);
        }
    });

    test("quoted passwords may contain semicolons", () => {
        const outcome = parseSqlConnectionString(
            "Server=s;User Id=u;Password='p;a;s;s';Database=d",
        );
        expect("parsed" in outcome).to.equal(true);
        if ("parsed" in outcome) {
            expect(outcome.parsed.password).to.equal("p;a;s;s");
        }
    });

    test("fails actionably without a server or auth", () => {
        const noServer = parseSqlConnectionString("Database=x;User Id=u;Password=p");
        expect("error" in noServer && noServer.error).to.include("Server");
        const noAuth = parseSqlConnectionString("Server=s;Database=x");
        expect("error" in noAuth && noAuth.error).to.include("Integrated Security");
    });

    test("label never contains credentials", () => {
        const outcome = parseSqlConnectionString(
            "Server=prod;Database=db;User ID=admin;Password=TopSecret123",
        );
        expect("parsed" in outcome).to.equal(true);
        if ("parsed" in outcome) {
            const label = connectionStringLabel(outcome.parsed);
            expect(label).to.include("prod");
            expect(label).to.include("db");
            expect(label).to.not.include("TopSecret123");
            expect(label).to.not.include("admin");
        }
    });
});
