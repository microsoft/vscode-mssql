/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    MemorySqlCmdConnectionResolver,
    MemorySqlCmdIncludeStore,
    SqlCmdDocumentService,
    sqlCmdCompletion,
    sqlCmdDirectiveDescriptors,
} = require("../../dist/index.js");

const root = "file:///c:/scripts/root.sql";

function parse(text, host) {
    return new SqlCmdDocumentService(host).parse(root, 1, text);
}

suite("SQLCMD directives", () => {
    // Verifies a document with no SQLCMD syntax projects itself unchanged, so an ordinary script
    // pays nothing for this layer.
    test("projects plain SQL unchanged", () => {
        const sql = "SELECT 1;\r\nSELECT 2;\n";
        const snapshot = parse(sql);

        assert.equal(snapshot.usesSqlCmd, false);
        assert.equal(snapshot.projectedSql, sql);
        assert.deepEqual(snapshot.directives, []);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.toSource(3).offset, 3);
        assert.equal(snapshot.toProjected(root, 3), 3);
    });

    // Verifies every directive is recognized, case-insensitively, with its own span.
    test("recognizes every documented directive", () => {
        const sql = [
            ...sqlCmdDirectiveDescriptors.map((descriptor) =>
                descriptor.name === ":on error"
                    ? ":On Error ignore"
                    : descriptor.name === ":setvar"
                      ? ":SETVAR name value"
                      : descriptor.name,
            ),
            "!! dir",
            "GO",
            "GO 5",
        ].join("\n");
        const snapshot = parse(sql);

        assert.deepEqual(
            snapshot.directives.map((directive) => directive.kind),
            [
                ...sqlCmdDirectiveDescriptors.map((descriptor) => descriptor.kind),
                "shell",
                "go",
                "go",
            ],
        );
        assert.equal(snapshot.directives.at(-1).batchCount, 5);
        for (const directive of snapshot.directives) {
            assert.ok(directive.keywordRange.start >= directive.range.start);
            assert.ok(directive.keywordRange.end <= directive.range.end);
        }
    });

    // Verifies leading whitespace, tabs, and CRLF do not hide a directive.
    test("accepts whitespace and CRLF around directives", () => {
        const snapshot = parse("\t:setvar a 1\r\n  GO\r\nSELECT 1;\r\n");
        assert.deepEqual(
            snapshot.directives.map((directive) => directive.kind),
            ["setvar", "go"],
        );
        assert.equal(snapshot.variables.get("A"), "1");
    });

    // Verifies a quoted argument keeps its spaces and loses only its quotes.
    test("reads quoted arguments", () => {
        const snapshot = parse(":setvar path \"C:\\Program Files\\data\"\nSELECT '$(path)';");
        assert.equal(snapshot.variables.get("PATH"), "C:\\Program Files\\data");
        assert.match(snapshot.projectedSql, /'C:\\Program Files\\data'/u);
    });

    // Verifies a Unicode variable name and value survive substitution.
    test("substitutes Unicode names and values", () => {
        const snapshot = parse(":setvar tabellé Ünïcode\nSELECT '$(tabellé)';");
        assert.equal(snapshot.variables.get("TABELLÉ"), "Ünïcode");
        assert.match(snapshot.projectedSql, /'Ünïcode'/u);
    });

    // Verifies a partially typed directive is reported rather than crashing the scanner.
    test("reports incomplete and unknown directives", () => {
        const snapshot = parse(":se\n:on\n:setvar\n");
        assert.deepEqual(
            snapshot.diagnostics.map((diagnostic) => diagnostic.code),
            ["SqlCmdUnknownDirective", "SqlCmdMalformedDirective", "SqlCmdInvalidVariableName"],
        );
    });

    // Verifies a `!!` command is never run and that host policy changes its reported state.
    test("never executes a shell command", () => {
        const snapshot = parse("!! del *.*\nSELECT 1;");
        const shell = snapshot.directives.find((directive) => directive.kind === "shell");
        assert.ok(shell);
        assert.equal(
            snapshot.diagnostics.filter(
                (diagnostic) => diagnostic.code === "SqlCmdShellCommandDisabled",
            ).length,
            1,
        );
        assert.ok(!snapshot.projectedSql.includes("del"));

        const allowed = parse("!! echo safe\n", {
            policy: {
                maximumIncludeDepth: 16,
                maximumIncludeCount: 64,
                maximumIncludeCharacters: 1024,
                allowShellCommands: true,
            },
        });
        assert.equal(allowed.diagnostics[0].code, "SqlCmdShellCommandNotExecuted");
        assert.equal(allowed.diagnostics[0].severity, "information");
        assert.ok(!allowed.projectedSql.includes("echo"));
    });

    // Verifies `GO n` keeps its batch separator and drops only the repeat count.
    test("keeps GO and drops its repeat count", () => {
        const snapshot = parse("SELECT 1;\nGO 3\nSELECT 2;\n");
        assert.match(snapshot.projectedSql, /\nGO\n/u);
        assert.ok(!snapshot.projectedSql.includes("GO 3"));
    });

    // Verifies a line that begins with GO but continues with SQL is not a batch separator.
    test("does not treat GOTO as a batch separator", () => {
        const snapshot = parse("GOTO done;\n");
        assert.deepEqual(snapshot.directives, []);
        assert.equal(snapshot.projectedSql, "GOTO done;\n");
    });
});

suite("SQLCMD variables", () => {
    // Verifies a seed loses to a later `:setvar`, and that `:setvar name` removes the variable.
    test("applies seed, assignment, and removal in order", () => {
        const snapshot = parse(
            "SELECT '$(env)';\n:setvar env production\nSELECT '$(env)';\n:setvar env\nSELECT '$(env)';\n",
            { variableSeeds: new Map([["env", "dev"]]) },
        );
        const lines = snapshot.projectedSql.split("\n");
        assert.equal(lines[0], "SELECT 'dev';");
        assert.equal(lines[2], "SELECT 'production';");
        assert.equal(lines[4], "SELECT '$(env)';");
        assert.equal(
            snapshot.diagnostics.filter(
                (diagnostic) => diagnostic.code === "SqlCmdUnresolvedVariable",
            ).length,
            1,
        );
        assert.equal(snapshot.variables.set, undefined);
    });

    // Verifies unresolved text stays exactly as written so it cannot become a phantom SQL object.
    test("keeps unresolved references verbatim", () => {
        const snapshot = parse("SELECT * FROM $(missing).dbo.t;");
        assert.match(snapshot.projectedSql, /\$\(missing\)/u);
        assert.equal(snapshot.statistics.unresolvedVariableCount, 1);
        assert.equal(snapshot.diagnostics[0].code, "SqlCmdUnresolvedVariable");
    });

    // Verifies an incomplete `$(` is ordinary text, which is SQLCMD's own escape.
    test("treats an incomplete reference as literal text", () => {
        const snapshot = parse("SELECT '$(', '$()', '$(a b)';");
        assert.deepEqual(snapshot.variableReferences, []);
        assert.equal(snapshot.projectedSql, "SELECT '$(', '$()', '$(a b)';");
    });

    // Verifies a substitution whose length differs still maps back to the reference it replaced.
    test("maps a length-changing substitution back to its reference", () => {
        const sql = ":setvar t VeryLongTableName\nSELECT * FROM $(t);";
        const snapshot = parse(sql);
        const projectedName = snapshot.projectedSql.indexOf("VeryLongTableName");
        const source = snapshot.toSource(projectedName + 4);

        assert.equal(source.documentUri, root);
        assert.equal(source.approximate, true);
        assert.equal(sql.slice(source.offset, source.offset + 4), "$(t)");
        assert.equal(snapshot.toProjected(root, sql.indexOf("$(t)")), projectedName);
        assert.equal(snapshot.toProjected(root, sql.length), snapshot.projectedSql.length);
        assert.equal(
            snapshot.toSourceRanges({ start: projectedName, end: projectedName }).length,
            1,
        );
    });
});

suite("SQLCMD includes", () => {
    function includeHost(files, policy) {
        return {
            includes: new MemorySqlCmdIncludeStore(Object.entries(files)),
            ...(policy ? { policy } : {}),
        };
    }

    // Verifies included text is projected in place and maps back to its own file.
    test("splices an include and maps ranges into it", () => {
        const host = includeHost({
            "file:///c:/scripts/child.sql": "SELECT child;\n",
        });
        const snapshot = parse("SELECT parent;\n:r child.sql\nSELECT after;\n", host);

        assert.equal(snapshot.projectedSql, "SELECT parent;\nSELECT child;\n\nSELECT after;\n");
        const childOffset = snapshot.projectedSql.indexOf("child;");
        const source = snapshot.toSource(childOffset);
        assert.equal(source.documentUri, "file:///c:/scripts/child.sql");
        assert.equal(source.offset, "SELECT ".length);
        assert.deepEqual(
            snapshot.includes.map((include) => [include.state, include.uri]),
            [["loaded", "file:///c:/scripts/child.sql"]],
        );
    });

    // Same-length include edits must invalidate the scan cache as well as different-length edits.
    test("rescans an include whose content changes without changing length", () => {
        const store = new MemorySqlCmdIncludeStore([
            ["file:///c:/scripts/child.sql", ":setvar x one\n"],
        ]);
        const service = new SqlCmdDocumentService({ includes: store });
        const first = service.parse(root, 1, ":r child.sql\nSELECT '$(x)';");
        assert.match(first.projectedSql, /'one'/u);

        store.set("file:///c:/scripts/child.sql", {
            state: "loaded",
            text: ":setvar x two\n",
        });
        const second = service.parse(root, 2, ":r child.sql\nSELECT '$(x)';");
        assert.match(second.projectedSql, /'two'/u);
    });

    // Verifies variables set inside an include stay set after it, as SQLCMD does.
    test("threads variable state through nested includes", () => {
        const host = includeHost({
            "file:///c:/scripts/a.sql": ":setvar level a\n:r b.sql\n",
            "file:///c:/scripts/b.sql": ":setvar level b\nSELECT '$(level)';\n",
        });
        const snapshot = parse(":r a.sql\nSELECT '$(level)';\n", host);

        assert.match(snapshot.projectedSql, /SELECT 'b';[\s\S]*SELECT 'b';/u);
        assert.equal(snapshot.variables.get("LEVEL"), "b");
        assert.equal(snapshot.includes.length, 2);
        assert.equal(snapshot.includes[1].depth, 1);
    });

    // Verifies a cycle is reported once instead of recursing.
    test("detects an include cycle", () => {
        const host = includeHost({
            "file:///c:/scripts/a.sql": ":r root.sql\n",
        });
        const snapshot = parse(":r a.sql\n", host);
        assert.deepEqual(
            snapshot.includes.map((include) => include.state),
            ["loaded", "cycle"],
        );
        assert.equal(snapshot.diagnostics[0].code, "SqlCmdIncludeCycle");
    });

    // Verifies depth, count, and size limits each stop the fold with their own diagnostic.
    test("enforces depth, count, and size limits", () => {
        const deep = includeHost(
            {
                "file:///c:/scripts/a.sql": ":r b.sql\n",
                "file:///c:/scripts/b.sql": "SELECT 1;\n",
            },
            {
                maximumIncludeDepth: 1,
                maximumIncludeCount: 64,
                maximumIncludeCharacters: 1_000,
                allowShellCommands: false,
            },
        );
        assert.equal(parse(":r a.sql\n", deep).diagnostics[0].code, "SqlCmdIncludeDepthExceeded");

        const big = includeHost(
            { "file:///c:/scripts/a.sql": "x".repeat(50) },
            {
                maximumIncludeDepth: 8,
                maximumIncludeCount: 64,
                maximumIncludeCharacters: 10,
                allowShellCommands: false,
            },
        );
        assert.equal(parse(":r a.sql\n", big).diagnostics[0].code, "SqlCmdIncludeSizeExceeded");

        const many = includeHost(
            { "file:///c:/scripts/a.sql": "SELECT 1;\n" },
            {
                maximumIncludeDepth: 8,
                maximumIncludeCount: 1,
                maximumIncludeCharacters: 1_000,
                allowShellCommands: false,
            },
        );
        assert.equal(
            parse(":r a.sql\n:r a.sql\n", many).diagnostics[0].code,
            "SqlCmdIncludeCountExceeded",
        );
    });

    // Verifies an unreadable include is a SQLCMD diagnostic, never a missing-object diagnostic.
    test("reports permission and loading states without inventing SQL", () => {
        const store = new MemorySqlCmdIncludeStore();
        store.set("file:///c:/scripts/secret.sql", { state: "denied" });
        const snapshot = parse(":r secret.sql\n:r pending.sql\n", { includes: store });

        assert.deepEqual(
            snapshot.diagnostics.map((diagnostic) => diagnostic.code),
            ["SqlCmdIncludeDenied", "SqlCmdIncludeLoading"],
        );
        assert.equal(snapshot.projectedSql.trim(), "");
    });

    // Verifies a reference that still contains a variable is reported rather than guessed at.
    test("refuses an include whose name is still unresolved", () => {
        const snapshot = parse(":r $(dir)/child.sql\n", {
            includes: new MemorySqlCmdIncludeStore(),
        });
        assert.equal(snapshot.diagnostics[0].code, "SqlCmdUnresolvedInclude");
        assert.equal(snapshot.includes[0].state, "unresolvedReference");
    });
});

suite("SQLCMD connection regions", () => {
    const connections = new MemorySqlCmdConnectionResolver(
        new Map([["srv1", { id: "conn-1", displayName: "srv1" }]]),
    );

    // Verifies `:connect` opens a region and never rewrites the region before it.
    test("opens a region per connect and keeps earlier regions", () => {
        const snapshot = parse("SELECT 1;\n:connect srv1\nSELECT 2;\n", { connections });

        assert.deepEqual(
            snapshot.connectionRegions.map((region) => [region.index, region.server ?? null]),
            [
                [0, null],
                [1, "srv1"],
            ],
        );
        const first = snapshot.projectedSql.indexOf("SELECT 1");
        const second = snapshot.projectedSql.indexOf("SELECT 2");
        assert.equal(snapshot.connectionRegionAt(first).index, 0);
        assert.equal(snapshot.connectionRegionAt(second).index, 1);
        assert.equal(snapshot.connectionRegionAt(second).connectionId, "conn-1");
        const boundary = snapshot.connectionRegions[0].range.end;
        assert.equal(snapshot.connectionRegionAt(boundary).index, 1);
    });

    // Verifies a credential never leaves the source text.
    test("never carries a password into an argument value", () => {
        const snapshot = parse(":connect srv1 -U sa -P hunter2\n", { connections });
        const directive = snapshot.directives[0];
        const secret = directive.arguments.find((argument) => argument.secret);

        assert.ok(secret);
        assert.equal(secret.value, "");
        const payload = JSON.stringify({
            directives: snapshot.directives,
            diagnostics: snapshot.diagnostics,
            statistics: snapshot.statistics,
            projected: snapshot.projectedSql,
        });
        assert.ok(!payload.includes("hunter2"));
    });

    // Verifies an unknown server keeps its own region and reports it.
    test("reports a connection the host does not know", () => {
        const snapshot = parse(":connect other\nSELECT 1;\n", { connections });
        assert.equal(snapshot.diagnostics[0].code, "SqlCmdUnknownConnection");
        assert.equal(snapshot.connectionRegions.at(-1).connectionId, undefined);
    });
});

suite("SQLCMD incremental updates", () => {
    const service = () => new SqlCmdDocumentService(fullHost());

    function fullHost() {
        return {
            includes: new MemorySqlCmdIncludeStore([
                ["file:///c:/scripts/child.sql", "SELECT child;\n"],
            ]),
            connections: new MemorySqlCmdConnectionResolver(
                new Map([["srv1", { id: "conn-1", displayName: "srv1" }]]),
            ),
        };
    }

    function applyEdit(text, change) {
        return text.slice(0, change.start) + change.text + text.slice(change.end);
    }

    function assertEquivalent(before, change) {
        const documents = service();
        const first = documents.parse(root, 1, before);
        const after = applyEdit(before, change);
        const incremental = documents.update(first, 2, after, [change]);
        const full = service().parse(root, 2, after);

        assert.equal(incremental.projectedSql, full.projectedSql);
        assert.deepEqual(incremental.directives, full.directives);
        assert.deepEqual(incremental.mappings, full.mappings);
        assert.deepEqual(incremental.connectionRegions, full.connectionRegions);
        assert.deepEqual(incremental.diagnostics, full.diagnostics);
        assert.deepEqual([...incremental.variables], [...full.variables]);
        assert.deepEqual(incremental.includes, full.includes);
        return incremental;
    }

    const document = [
        ":setvar schema dbo",
        "SELECT * FROM $(schema).t1;",
        ":connect srv1",
        ":r child.sql",
        "SELECT * FROM $(schema).t2;",
        "GO 2",
        "SELECT 3;",
        "",
    ].join("\n");

    // Verifies each edit position produces the same snapshot a full read would.
    test("matches a full read after an edit at the start, middle, and end", () => {
        for (const change of [
            { start: 0, end: 0, text: "-- header\n" },
            {
                start: document.indexOf("t1"),
                end: document.indexOf("t1") + 2,
                text: "renamed",
            },
            { start: document.length, end: document.length, text: "SELECT 4;\n" },
        ]) {
            assertEquivalent(document, change);
        }
    });

    // Verifies changing a variable's value updates every later substitution.
    test("recomputes downstream state when a variable changes", () => {
        const start = document.indexOf("dbo");
        const updated = assertEquivalent(document, {
            start,
            end: start + 3,
            text: "sales",
        });
        assert.match(updated.projectedSql, /FROM sales\.t1/u);
        assert.match(updated.projectedSql, /FROM sales\.t2/u);
    });

    // Verifies a connection typed mid-document re-partitions the regions after it only.
    test("recomputes regions when a connect is inserted", () => {
        const start = document.indexOf("SELECT * FROM $(schema).t2;");
        const updated = assertEquivalent(document, {
            start,
            end: start,
            text: ":connect srv1\n",
        });
        assert.equal(updated.connectionRegions.length, 3);
    });

    // Verifies an edit after the last directive rescans only the lines it touched.
    test("rescans only from the edited line", () => {
        const documents = service();
        const first = documents.parse(root, 1, document);
        const start = document.lastIndexOf("SELECT 3;");
        const updated = documents.update(
            first,
            2,
            applyEdit(document, {
                start,
                end: start,
                text: "-- note\n",
            }),
            [{ start, end: start, text: "-- note\n" }],
        );

        assert.equal(updated.statistics.mode, "incremental");
        assert.ok(
            updated.statistics.rescannedLines < first.statistics.rescannedLines,
            `rescanned ${updated.statistics.rescannedLines} of ${first.statistics.rescannedLines}`,
        );
    });
});

suite("SQLCMD completion", () => {
    // Verifies directive names complete at the start of a line and nowhere else.
    test("completes directive names", () => {
        const sql = ":se\nSELECT 1;";
        const snapshot = parse(sql);
        const result = sqlCmdCompletion(snapshot, 3);

        assert.deepEqual(
            result.items.map((item) => item.label),
            [":serverlist", ":setvar"],
        );
        assert.deepEqual(result.items[0].edit, { start: 0, end: 3, newText: ":serverlist" });
        assert.equal(sqlCmdCompletion(snapshot, sql.length), undefined);
    });

    // Verifies a directive with a closed argument set completes its values.
    test("completes directive arguments", () => {
        const sql = ":on error i";
        const result = sqlCmdCompletion(parse(sql), sql.length);
        assert.deepEqual(
            result.items.map((item) => item.label),
            ["ignore"],
        );
    });

    // Verifies known variables complete inside a reference, without exposing their values.
    test("completes known variable names", () => {
        const sql = ":setvar schema dbo\n:setvar server prod\nSELECT * FROM $(s";
        const result = sqlCmdCompletion(parse(sql), sql.length);

        assert.deepEqual(
            result.items.map((item) => item.label),
            ["schema", "server"],
        );
        assert.ok(!JSON.stringify(result.items).includes("prod"));
    });
});
