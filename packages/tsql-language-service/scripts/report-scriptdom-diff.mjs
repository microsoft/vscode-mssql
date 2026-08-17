#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Differential report against ScriptDOM, the authoritative T-SQL parser.
//
// For every conformance fixture this records what ScriptDOM says at the fixture's own compatibility
// level and what this package's parser says, then classifies the disagreement:
//
//   bothClean          - both accept. Nothing to do.
//   oursOnlyRecovers   - ScriptDOM accepts, we recover. A real gap in our grammar; this is the
//                        work Milestone 1 exists to remove.
//   scriptDomRejects   - ScriptDOM also rejects. If the manifest marks the fixture `parseable`,
//                        the expectation itself is suspect and needs review with this evidence.
//   bothReject         - both reject and the manifest expects recovery. Working as intended.
//
// ScriptDOM is loaded through PowerShell because it is a .NET assembly; the helper script is
// emitted next to the report so the run is reproducible.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { ImmutableTextSnapshot, LezerSyntaxService } = require(
    join(packageRoot, "dist", "index.js"),
);

const SCRIPTDOM_DLL =
    process.env.SCRIPTDOM_DLL ??
    "C:\\Users\\aaskhan\\src\\vscode-mssql-parser\\ScriptDOM\\out\\Release\\net8.0\\Microsoft.SqlServer.TransactSql.ScriptDom.dll";

// ScriptDOM exposes one parser class per compatibility level; a fixture is checked at its own.
const PARSER_FOR_VERSION = new Map([
    [80, "TSql80Parser"],
    [90, "TSql90Parser"],
    [100, "TSql100Parser"],
    [110, "TSql110Parser"],
    [120, "TSql120Parser"],
    [130, "TSql130Parser"],
    [140, "TSql140Parser"],
    [150, "TSql150Parser"],
    [160, "TSql160Parser"],
    [170, "TSql170Parser"],
]);
const DEFAULT_PARSER = "TSql170Parser";

const POWERSHELL = String.raw`
# Paths arrive through the environment: named parameters bind inconsistently across hosts.
$Dll = $env:SCRIPTDOM_DLL
$InputPath = $env:SCRIPTDOM_IN
$OutputPath = $env:SCRIPTDOM_OUT
Add-Type -Path $Dll
$items = Get-Content -Raw -LiteralPath $InputPath | ConvertFrom-Json
$all = New-Object System.Collections.ArrayList
foreach ($item in $items) {
    # Build the type name first: PowerShell reads New-Object ("..." + $x)($true) as a method call.
    $typeName = "Microsoft.SqlServer.TransactSql.ScriptDom." + $item.parser
    $parser = New-Object -TypeName $typeName -ArgumentList $true
    $errs = $null
    try { $null = $parser.Parse((New-Object System.IO.StringReader($item.sql)), [ref]$errs) }
    catch { $null = $all.Add(@(@{ number = -1; message = $_.Exception.Message })); continue }
    $list = New-Object System.Collections.ArrayList
    foreach ($e in $errs) { $null = $list.Add(@{ number = $e.Number; message = $e.Message; line = $e.Line }) }
    $null = $all.Add($list.ToArray())
}
ConvertTo-Json -InputObject $all.ToArray() -Depth 5 -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8
`;

const corpusRoot = join(packageRoot, "test", "corpus", "tsql-conformance");
const manifest = JSON.parse(await readFile(join(corpusRoot, "manifest.json"), "utf8"));
const service = new LezerSyntaxService();

const work = [];
for (const file of manifest.files) {
    const text = decode(await readFile(join(corpusRoot, file.path)), file.encoding);
    const snapshot = service.parse(new ImmutableTextSnapshot(`corpus:/${file.path}`, 1, text));
    work.push({
        path: file.path,
        expectation: file.expectation,
        versionHint: file.versionHint,
        parser: PARSER_FOR_VERSION.get(file.versionHint ?? 0) ?? DEFAULT_PARSER,
        ourRaw: snapshot.statistics.rawErrorNodeCount,
        sql: text,
    });
}
const scriptDom = await runScriptDom(work);

const rows = work.map((item, index) => {
    const errors = scriptDom[index] ?? [];
    const theirs = errors.length;
    const ours = item.ourRaw;
    const verdict =
        theirs === 0 && ours === 0
            ? "bothClean"
            : theirs === 0 && ours > 0
              ? "oursOnlyRecovers"
              : theirs > 0 && item.expectation === "recovery"
                ? "bothReject"
                : "scriptDomRejects";
    return { ...item, sql: undefined, theirs, firstError: errors[0], verdict };
});

const counts = new Map();
for (const row of rows) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);

console.log(`ScriptDOM differential over ${rows.length} conformance fixtures`);
for (const [verdict, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${verdict}`);
}

const suspect = rows.filter((r) => r.verdict === "scriptDomRejects");
if (suspect.length > 0) {
    console.log(
        `\nFixtures marked '${suspect[0].expectation}' that ScriptDOM also rejects ` +
            `(expectation needs review, with this evidence):`,
    );
    for (const row of suspect.slice(0, 40)) {
        const err = row.firstError;
        console.log(
            `  ${row.path} [v${row.versionHint ?? "-"} via ${row.parser}] ours=${row.ourRaw} theirs=${row.theirs}`,
        );
        if (err) console.log(`      ${err.number}: ${String(err.message).slice(0, 110)}`);
    }
}

const gaps = rows
    .filter((r) => r.verdict === "oursOnlyRecovers")
    .sort((a, b) => b.ourRaw - a.ourRaw);
if (gaps.length > 0) {
    console.log(`\nOur remaining gaps (ScriptDOM accepts, we recover) — top 25 by node count:`);
    for (const row of gaps.slice(0, 25)) {
        console.log(
            `  ${String(row.ourRaw).padStart(4)}  ${row.path} [v${row.versionHint ?? "-"}]`,
        );
    }
    console.log(`  total nodes in gap fixtures: ${gaps.reduce((n, r) => n + r.ourRaw, 0)}`);
}

const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex >= 0) {
    await writeFile(process.argv[jsonIndex + 1], JSON.stringify(rows, null, 1), "utf8");
}

async function runScriptDom(items) {
    const dir = await mkdtemp(join(tmpdir(), "scriptdom-"));
    const inputPath = join(dir, "in.json");
    const outputPath = join(dir, "out.json");
    const scriptPath = join(dir, "check.ps1");
    await writeFile(
        inputPath,
        JSON.stringify(items.map((i) => ({ sql: i.sql, parser: i.parser }))),
        "utf8",
    );
    await writeFile(scriptPath, POWERSHELL, "utf8");
    try {
        await run(
            // pwsh, not powershell.exe: ScriptDOM targets .NET 8, which Windows PowerShell 5.1
            // cannot Add-Type, and the failure surfaces only as a null type at New-Object time.
            process.env.PWSH ?? "pwsh",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
            {
                maxBuffer: 64 * 1024 * 1024,
                env: {
                    ...process.env,
                    SCRIPTDOM_DLL,
                    SCRIPTDOM_IN: inputPath,
                    SCRIPTDOM_OUT: outputPath,
                },
            },
        );
        return JSON.parse(await readFile(outputPath, "utf8"));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

function decode(bytes, encoding) {
    if (encoding === "utf16le") return bytes.subarray(2).toString("utf16le");
    if (encoding === "utf16be") {
        const body = Buffer.from(bytes.subarray(2));
        for (let index = 0; index + 1 < body.length; index += 2) {
            [body[index], body[index + 1]] = [body[index + 1], body[index]];
        }
        return body.toString("utf16le");
    }
    if (encoding === "utf8-bom") return bytes.subarray(3).toString("utf8");
    return bytes.toString("utf8");
}
