/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { getLocalDatabaseSources } from "../../src/deployment/localDatabaseSources";

suite("Local database deployment sources", () => {
    test("includes localhost aliases, protocols, ports and named instances", () => {
        const servers = [
            "localhost",
            "LOCALHOST,1433",
            " tcp:localhost,1434 ",
            "localhost\\SQLEXPRESS",
            "127.0.0.1,1433",
            "127.0.0.2",
            "[::1],1433",
            "::1",
            "(local)\\SQL",
            ".",
            ".\\SQLEXPRESS",
        ];
        const sources = getLocalDatabaseSources(
            servers.map((server, index) => ({
                id: String(index),
                server,
                database: "InventoryDb",
            })),
        );
        expect(sources.map((source) => source.server)).to.deep.equal(
            servers.map((server) => server.trim()),
        );
    });

    test("excludes remote hosts and localhost prefix lookalikes", () => {
        const servers = [
            "localhost.example.com",
            "localhost-other",
            "127.0.0.1.example.com",
            "server.database.windows.net",
            "192.168.1.20,1433",
            "[::10],1433",
            "",
        ];
        expect(
            getLocalDatabaseSources(
                servers.map((server, index) => ({
                    id: String(index),
                    server,
                    database: "InventoryDb",
                })),
            ),
        ).to.deep.equal([]);
    });

    test("excludes server-level connections without a selected database", () => {
        const sources = getLocalDatabaseSources([
            { id: "missing", server: "localhost,1433" },
            { id: "empty", server: "localhost,1433", database: "" },
            { id: "whitespace", server: "localhost,1433", database: "   " },
            { id: "database", server: "localhost,1433", database: "InventoryDb" },
        ]);
        expect(sources.map((source) => source.id)).to.deep.equal(["database"]);
    });

    test("deduplicates by identity, not display values, and only returns display fields", () => {
        const connection = {
            id: "local-one",
            profileName: "Development",
            server: "localhost,1433",
            database: "InventoryDb",
            password: "not-for-the-webview",
        };
        const sources = getLocalDatabaseSources([
            connection,
            { ...connection, database: "RecentDb" },
            { ...connection, id: "local-two" },
            { server: "localhost", database: "NoIdentity" },
        ]);
        expect(sources).to.deep.equal([
            {
                id: "local-one",
                profileName: "Development",
                server: "localhost,1433",
                database: "InventoryDb",
                isConnected: false,
                serverVersion: undefined,
            },
            {
                id: "local-two",
                profileName: "Development",
                server: "localhost,1433",
                database: "InventoryDb",
                isConnected: false,
                serverVersion: undefined,
            },
        ]);
    });

    test("uses active connection metadata instead of a saved profile with the same identity", () => {
        const saved = {
            id: "local",
            profileName: "Development",
            server: "localhost,1433",
            database: "InventoryDb",
        };
        expect(
            getLocalDatabaseSources([
                saved,
                {
                    id: saved.id,
                    server: saved.server,
                    database: "AppDb",
                    isConnected: true,
                    serverVersion: "17.0.1000",
                },
                saved,
            ]),
        ).to.deep.equal([
            {
                ...saved,
                database: "AppDb",
                isConnected: true,
                serverVersion: "17.0.1000",
            },
        ]);
    });
});
