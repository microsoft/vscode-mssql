/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Verifies the edit engine against a real SQL Server.
 *
 * The unit tests prove what the engine generates; this proves the server accepts it and behaves
 * as intended. It creates its own throwaway database, exercises the behaviours that matter, and
 * drops it again, so it can be pointed at any server without leaving anything behind.
 *
 * Usage:
 *   node scripts/verify-against-server.mjs --container sqlpreview22 --password '<sa password>'
 *   node scripts/verify-against-server.mjs --server localhost,1433 --user sa --password '<pw>'
 *
 * With --container it runs sqlcmd inside that Docker container. Otherwise it uses a local
 * sqlcmd on PATH.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = "../dist/edit/index.js";
const {
    EditSession,
    chooseKeyStrategy,
    compileBatch,
    compileCellQuery,
    compileCountQuery,
    compilePageQuery,
    editorKindFor,
    loadTableMetadata,
    resolvePageOrder,
} = require(engine);

const args = parseArgs(process.argv.slice(2));
const DB = args.database ?? "SqlEditVerify";

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 2) {
        if (!argv[i].startsWith("--")) {
            continue;
        }
        out[argv[i].slice(2)] = argv[i + 1];
    }
    if (!out.password) {
        console.error("A --password is required. See the header of this file for usage.");
        process.exit(2);
    }
    return out;
}

/** Runs a batch, optionally asking for JSON so results can be read back as objects. */
function sqlcmd(sql, { json = true, database = DB } = {}) {
    const text = json ? `SET NOCOUNT ON;\n${sql}\nFOR JSON PATH, INCLUDE_NULL_VALUES;` : sql;
    const sqlcmdArgs = [
        "-S",
        args.container ? "localhost" : (args.server ?? "localhost"),
        "-U",
        args.user ?? "sa",
        "-C",
        "-b",
        "-d",
        database,
        "-y",
        "0",
        "-w",
        "65535",
        "-Q",
        text,
    ];
    const env = { ...process.env, SQLCMDPASSWORD: args.password };
    const out = args.container
        ? execFileSync(
              "docker",
              [
                  "exec",
                  "-e",
                  `SQLCMDPASSWORD=${args.password}`,
                  args.container,
                  "/opt/mssql-tools18/bin/sqlcmd",
                  ...sqlcmdArgs,
              ],
              { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
          )
        : execFileSync("sqlcmd", sqlcmdArgs, {
              encoding: "utf8",
              env,
              maxBuffer: 64 * 1024 * 1024,
          });

    if (!json) {
        return out.trim();
    }
    const start = out.indexOf("[");
    // sqlcmd wraps long values across lines; FOR JSON never emits a literal newline of its own.
    return start >= 0 ? out.slice(start).replace(/\r?\n/g, "").trim() : "";
}

/** Binary arrives base64 from FOR JSON; the data plane sends it as hex, so match that. */
function makeRunner(binaryColumns = new Set(["Version"])) {
    return {
        async query(sql) {
            const text = sqlcmd(sql);
            if (!text) {
                return { rows: [], columns: [] };
            }
            const rows = JSON.parse(text).map((row) => {
                const out = {};
                for (const [key, value] of Object.entries(row)) {
                    out[key] =
                        binaryColumns.has(key) && typeof value === "string"
                            ? `0x${Buffer.from(value, "base64").toString("hex")}`
                            : value;
                }
                return out;
            });
            return { rows, columns: Object.keys(rows[0] ?? {}).map((name) => ({ name })) };
        },
    };
}

let failures = 0;
function check(name, ok, detail = "") {
    if (!ok) {
        failures++;
    }
    console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? `\n          ${detail}` : ""}`);
}

async function main() {
    console.log(`Verifying against ${args.container ?? args.server ?? "localhost"}\n`);

    sqlcmd(`IF DB_ID('${DB}') IS NULL CREATE DATABASE ${DB};`, { json: false, database: "master" });
    const version = sqlcmd("SELECT CONVERT(varchar(20), SERVERPROPERTY('ProductVersion')) AS v");
    const major = Number(JSON.parse(version)[0].v.split(".")[0]);
    console.log(`Server major version ${major}\n`);

    const modern = major >= 17; // json and vector are SQL Server 2025 and later.
    sqlcmd(
        `
IF OBJECT_ID('dbo.Verify') IS NOT NULL DROP TABLE dbo.Verify;
IF TYPE_ID('dbo.DisplayName') IS NOT NULL DROP TYPE dbo.DisplayName;
CREATE TYPE dbo.DisplayName FROM nvarchar(100) NULL;
CREATE TABLE dbo.Verify (
    Id      int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Name    dbo.DisplayName NULL,
    Amount  decimal(12,2) NULL,
    Doc     xml NULL,
    Node    hierarchyid NULL,
    Spot    geography NULL,
    ${modern ? "Payload json NULL,\n    Embedding vector(3) NULL," : ""}
    Computed AS (Amount * 2),
    Version rowversion NOT NULL
);
INSERT INTO dbo.Verify (Name, Amount, Doc, Node, Spot${modern ? ", Payload, Embedding" : ""})
VALUES (N'O''Brien', 10.50, N'<order id="1"/>', hierarchyid::Parse('/1/'),
        geography::STGeomFromText('POINT(-122.35 47.62)', 4326)
        ${modern ? `, N'{"sku":"A"}', N'[0.1,0.2,0.3]'` : ""});
IF OBJECT_ID('dbo.Heap') IS NOT NULL DROP TABLE dbo.Heap;
CREATE TABLE dbo.Heap (A int NULL, B nvarchar(50) NULL);
INSERT INTO dbo.Heap VALUES (2, N'y'), (2, N'y');`,
        { json: false },
    );

    const runner = makeRunner();

    console.log("Metadata and row identity");
    const meta = await loadTableMetadata(runner, "dbo", "Verify");
    const key = chooseKeyStrategy(meta);
    check("the primary key is chosen and explained", key.kind === "primaryKey", key.explanation);
    check(
        "identity, computed and rowversion are read-only",
        !meta.columns.find((c) => c.name === "Id").isWritable &&
            !meta.columns.find((c) => c.name === "Computed").isWritable &&
            !meta.columns.find((c) => c.name === "Version").isWritable,
    );
    check(
        "the rowversion is found and used as the concurrency token",
        meta.rowVersionColumn === "Version",
    );
    const alias = meta.columns.find((c) => c.name === "Name");
    check(
        "alias types retain their declaration while using the base type",
        alias?.declaredTypeName === "DisplayName" &&
            alias.declaredTypeSchema === "dbo" &&
            alias.typeName === "nvarchar" &&
            alias.isWritable === true,
        JSON.stringify(alias),
    );

    console.log("\nReading");
    const page = await runner.query(compilePageQuery(meta, key, { pageSize: 10 }).sql);
    const row = page.rows[0];
    check("xml reads as its document text", String(row.Doc).includes("<order"), String(row.Doc));
    check("hierarchyid reads as a path", row.Node === "/1/", String(row.Node));
    check(
        "geography carries its SRID",
        String(row.Spot).startsWith("SRID=4326;"),
        String(row.Spot),
    );
    if (modern) {
        check(
            "json reads as its document text",
            String(row.Payload).includes("sku"),
            String(row.Payload),
        );
        check(
            "vector reads as an array",
            /^\[.*\]$/.test(String(row.Embedding)),
            String(row.Embedding),
        );
    }
    const count = await runner.query(
        compileCountQuery(meta, [{ column: "Name", operator: "contains", value: "O'Brien" }]),
    );
    check("a filter containing a quote matches", Number(count.rows[0].total) === 1);

    console.log("\nSaving");
    const edits = [
        {
            rowId: 1,
            kind: "update",
            values: {
                Name: "'); DROP TABLE dbo.Verify; --",
                Doc: '<order id="2"/>',
                Node: "/2/5/",
                Spot: "SRID=4326;POINT(-0.1276 51.5072)",
                ...(modern ? { Payload: '{"sku":"B"}', Embedding: "[0.9,0.8,0.7]" } : {}),
            },
            original: { Id: String(row.Id), Version: row.Version },
        },
    ];
    sqlcmd(compileBatch(meta, key, edits).sql, { json: false });
    const after = (await runner.query(compilePageQuery(meta, key, { pageSize: 10 }).sql)).rows[0];
    check(
        "an injection attempt is stored as text, not executed",
        after.Name.startsWith("');"),
        after.Name,
    );
    check("xml round-trips", String(after.Doc).includes('id="2"'));
    check("hierarchyid round-trips", after.Node === "/2/5/");
    if (modern) {
        check("json round-trips", String(after.Payload).includes('"B"'));
        check("vector round-trips", Math.abs(JSON.parse(String(after.Embedding))[0] - 0.9) < 1e-6);
    }

    console.log("\nSafety");
    const stale = compileBatch(meta, key, [
        {
            rowId: 2,
            kind: "update",
            values: { Name: "should not apply" },
            original: { Id: String(row.Id), Version: row.Version },
        },
    ]);
    check(
        "a stale rowversion is refused",
        threw(() => sqlcmd(stale.sql, { json: false })),
    );
    const unchanged = (await runner.query(compilePageQuery(meta, key, { pageSize: 10 }).sql))
        .rows[0];
    check("the row someone else changed is left alone", unchanged.Name === after.Name);

    const fresh = (await runner.query(compilePageQuery(meta, key, { pageSize: 10 }).sql)).rows[0];
    const mixed = compileBatch(meta, key, [
        {
            rowId: 3,
            kind: "update",
            values: { Name: "atomic" },
            original: { Id: String(fresh.Id), Version: fresh.Version },
        },
        {
            rowId: 4,
            kind: "update",
            values: { Name: "never" },
            original: { Id: "999999", Version: "0x0000000000000001" },
        },
    ]);
    check(
        "a failing statement rolls the whole save back",
        threw(() => sqlcmd(mixed.sql, { json: false })),
    );
    const afterMixed = (await runner.query(compilePageQuery(meta, key, { pageSize: 10 }).sql))
        .rows[0];
    check(
        "nothing from the failed save was applied",
        afterMixed.Name === fresh.Name,
        afterMixed.Name,
    );

    const heap = await loadTableMetadata(runner, "dbo", "Heap");
    const heapKey = chooseKeyStrategy(heap);
    check(
        "a table with no key falls back to all columns",
        heapKey.kind === "allColumns",
        heapKey.explanation,
    );
    const ambiguous = compileBatch(heap, heapKey, [
        { rowId: 5, kind: "update", values: { B: "z" }, original: { A: "2", B: "y" } },
    ]);
    check(
        "an edit matching two identical rows is refused",
        threw(() => sqlcmd(ambiguous.sql, { json: false })),
    );
    const heapRows = await runner.query("SELECT A, B FROM dbo.Heap");
    check(
        "neither ambiguous row changed",
        heapRows.rows.every((r) => r.B === "y"),
    );

    console.log("\nEditor hints");
    const kinds = Object.fromEntries(
        meta.columns.map((c) => [c.name, editorKindFor(c.typeName, c.maxLength, c.isWritable)]),
    );
    check(
        "document columns are marked for a real editor",
        kinds.Doc === "xml" && kinds.Spot === "spatial",
        JSON.stringify(kinds),
    );

    const order = resolvePageOrder(undefined, key);
    const cell = await runner.query(compileCellQuery(meta, "Doc", { Id: String(after.Id) }, order));
    check(
        "a full-cell read returns the whole document",
        String(cell.rows[0].Doc).includes('id="2"'),
    );

    sqlcmd(`ALTER DATABASE ${DB} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${DB};`, {
        json: false,
        database: "master",
    });

    console.log(
        failures === 0
            ? "\nEverything passed. The throwaway database has been dropped."
            : `\n${failures} check(s) FAILED. The throwaway database has been dropped.`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

function threw(fn) {
    try {
        fn();
        return false;
    } catch {
        return true;
    }
}

main().catch((error) => {
    console.error("VERIFY ERROR:", error.message);
    process.exit(1);
});
