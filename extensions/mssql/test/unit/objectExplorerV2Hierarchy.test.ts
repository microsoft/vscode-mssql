/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B22 (OE_V1_PARITY_PLAN): hierarchy registry resolution + v1 label/tooltip
 * parity. The label recipe is pinned AGAINST the classic implementation
 * (models/connectionInfo.getConnectionDisplayName) so drift in either copy
 * fails here, not in a dogfood session.
 */

import { expect } from "chai";
import { getConnectionDisplayName } from "../../src/models/connectionInfo";
import { IConnectionInfo } from "vscode-mssql";
import {
    connectionDisplayLabel,
    connectionTooltipLines,
    disambiguationLines,
    OeV2ConnectionLabelFacts,
} from "../../src/objectExplorer/v2/tree/oeV2ConnectionLabel";
import {
    isSystemDatabaseName,
    OeV2FolderDef,
    resolveFolders,
} from "../../src/objectExplorer/v2/tree/oeV2Hierarchy";
import { childrenOfGroup } from "../../src/objectExplorer/v2/tree/oeV2NodeFactory";
import { decodePath, encodePath } from "../../src/objectExplorer/v2/tree/oeV2Path";
import { OeV2ProfileTree } from "../../src/objectExplorer/v2/sessions/oeV2ProfileAdapter";

suite("Object Explorer v2 hierarchy registry (B22)", () => {
    test("database scope resolves the six folders in SSMS order", () => {
        const folders = resolveFolders("database", {});
        expect(folders.map((def) => def.id)).to.deep.equal([
            "tables",
            "views",
            "storedProcedures",
            "functions",
            "synonyms",
            "schemas",
        ]);
        expect(folders.map((def) => def.label)).to.deep.equal([
            "Tables",
            "Views",
            "Stored Procedures",
            "Functions",
            "Synonyms",
            "Schemas",
        ]);
    });

    test("server scope resolves Databases only (pre-B23 content)", () => {
        expect(resolveFolders("server", {}).map((def) => def.id)).to.deep.equal(["databases"]);
    });

    test("gates: validFor, system-folder stripping, nonEmpty presence, sortLast", () => {
        const registry: OeV2FolderDef[] = [
            { id: "plain", label: "Plain", scope: "database", order: 1, section: "s" },
            {
                id: "sys",
                label: "System Things",
                scope: "database",
                order: 0,
                section: "s",
                isSystemFolder: true,
            },
            {
                id: "modern",
                label: "Modern Only",
                scope: "database",
                order: 2,
                section: "s",
                validFor: (facts) => (facts.serverMajorVersion ?? 0) >= 16,
            },
            {
                id: "droppedLedger",
                label: "Dropped Ledger Tables",
                scope: "database",
                order: 0,
                section: "s",
                presence: "nonEmpty",
                sortLast: true,
            },
            {
                id: "child",
                label: "Nested",
                scope: "database",
                order: 0,
                section: "s",
                parentId: "plain",
            },
        ];
        // User database, old server, no dropped-ledger rows: only "plain".
        expect(
            resolveFolders(
                "database",
                { isSystemDatabase: false, serverMajorVersion: 15 },
                { hasItems: (def) => def.id !== "droppedLedger" },
                registry,
            ).map((def) => def.id),
        ).to.deep.equal(["plain"]);
        // System database on 2022 with rows: everything, dropped-ledger LAST
        // despite order 0.
        expect(
            resolveFolders(
                "database",
                { isSystemDatabase: true, serverMajorVersion: 16 },
                { hasItems: () => true },
                registry,
            ).map((def) => def.id),
        ).to.deep.equal(["sys", "plain", "modern", "droppedLedger"]);
        // Nested folders resolve under their parent only.
        expect(
            resolveFolders("database", {}, { parentId: "plain" }, registry).map((def) => def.id),
        ).to.deep.equal(["child"]);
    });

    test("system database names match the STS rule", () => {
        for (const name of ["master", "Model", "MSDB", "tempdb"]) {
            expect(isSystemDatabaseName(name), name).to.equal(true);
        }
        expect(isSystemDatabaseName("AdventureWorks")).to.equal(false);
        expect(isSystemDatabaseName(undefined)).to.equal(false);
    });

    test("path codec: nested folder ids with '/' round-trip", () => {
        const path = {
            kind: "serverFolder" as const,
            connectionId: "p1",
            folder: "security/logins",
        };
        expect(decodePath(encodePath(path))).to.deep.equal(path);
        const dbPath = {
            kind: "databaseFolder" as const,
            connectionId: "p1",
            database: "Db",
            folder: "programmability/storedProcedures",
        };
        expect(decodePath(encodePath(dbPath))).to.deep.equal(dbPath);
    });
});

suite("Object Explorer v2 connection labels (B22 / K6)", () => {
    const CASES: { name: string; profile: OeV2ConnectionLabelFacts }[] = [
        {
            name: "profileName wins",
            profile: { profileName: "Prod East", server: "srv", database: "AppDb" },
        },
        {
            name: "SqlLogin shows user",
            profile: {
                server: "localhost",
                database: "AppDb",
                authenticationType: "SqlLogin",
                user: "sa",
            },
        },
        {
            name: "AzureMFA shows email",
            profile: {
                server: "srv.database.windows.net",
                database: "AppDb",
                authenticationType: "AzureMFA",
                email: "karl@contoso.com",
            },
        },
        {
            name: "Integrated shows auth type",
            profile: { server: "localhost", authenticationType: "Integrated" },
        },
        {
            name: "empty database renders <default>",
            profile: { server: "localhost", database: "", authenticationType: "Integrated" },
        },
    ];

    test("label recipe matches classic getConnectionDisplayName", () => {
        for (const testCase of CASES) {
            expect(connectionDisplayLabel(testCase.profile), testCase.name).to.equal(
                getConnectionDisplayName(testCase.profile as unknown as IConnectionInfo),
            );
        }
    });

    test("tooltip lists non-default properties in classic order and wording", () => {
        const lines = connectionTooltipLines({
            profileName: "Prod East",
            server: "localhost",
            database: "AppDb",
            authenticationType: "Integrated",
            user: "ignored-for-integrated",
            port: 1433,
            connectTimeout: 30, // real default — omitted
            commandTimeout: 60,
            alwaysEncrypted: true,
        });
        expect(lines).to.deep.equal([
            "Prod East",
            "Server: localhost",
            "Database: AppDb",
            "Authentication Type: Windows Authentication",
            "Port: 1433",
            "Command Timeout: 60",
            "Always Encrypted: Enabled",
        ]);
    });

    test("sql-auth tooltip keeps the user line and hides default auth type", () => {
        const lines = connectionTooltipLines({
            server: "srv",
            authenticationType: "SqlLogin",
            user: "sa",
        });
        expect(lines).to.deep.equal(["Server: srv", "User: sa"]);
    });

    test("disambiguation: tied labels surface the differing properties", () => {
        const a = { server: "srv", authenticationType: "Integrated", port: 1433 };
        const b = { server: "srv", authenticationType: "Integrated", port: 1533 };
        expect(disambiguationLines(a, [b])).to.deep.equal(["Port: 1433"]);
        expect(disambiguationLines(b, [a])).to.deep.equal(["Port: 1533"]);
        // identical facts → nothing to distinguish
        expect(disambiguationLines(a, [a])).to.deep.equal([]);
    });

    test("factory appends disambiguation only to tied siblings", () => {
        const stored = (port: number) => ({
            server: "srv",
            authenticationType: "Integrated" as const,
            port,
        });
        const tree: OeV2ProfileTree = {
            groups: [],
            profiles: [
                {
                    profileId: "a",
                    displayName: "srv, <default> (Integrated)",
                    server: "srv",
                    authKind: "integrated",
                    stored: stored(1433),
                },
                {
                    profileId: "b",
                    displayName: "srv, <default> (Integrated)",
                    server: "srv",
                    authKind: "integrated",
                    stored: stored(1533),
                },
                {
                    profileId: "c",
                    displayName: "other, <default> (Integrated)",
                    server: "other",
                    authKind: "integrated",
                    stored: { server: "other", authenticationType: "Integrated" },
                },
            ],
        };
        const nodes = childrenOfGroup(tree, undefined);
        const tiedTooltips = nodes
            .filter((node) => node.label === "srv, <default> (Integrated)")
            .map((node) => node.tooltip ?? "");
        expect(tiedTooltips).to.have.length(2);
        expect(tiedTooltips[0]).to.include("Differs from same-named connections:");
        expect(tiedTooltips[0]).to.include("Port: 1433");
        expect(tiedTooltips[1]).to.include("Port: 1533");
        const untied = nodes.find((node) => node.label === "other, <default> (Integrated)");
        expect(untied?.tooltip ?? "").to.not.include("Differs");
    });
});
