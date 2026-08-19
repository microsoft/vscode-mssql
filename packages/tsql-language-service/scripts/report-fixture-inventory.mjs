#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Milestone 1 fixture inventory.
//
// Enumerates every conformance and real-world fixture that still carries a raw recovery node,
// assigns each recovery node to a grammar family, and classifies each fixture as valid/supported,
// valid/profile-gated, intentionally malformed, or a negative diagnostic fixture. The milestone
// requires a complete, reviewable classification rather than a self-selected sample, and the counts
// have to stay reproducible as the grammar changes, so this is a script rather than a static list.
//
// Usage:
//   node scripts/report-fixture-inventory.mjs                     # summary to stdout
//   node scripts/report-fixture-inventory.mjs --markdown <path>   # full document
//   node scripts/report-fixture-inventory.mjs --ledger <path>     # one row per recovery node

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { ImmutableTextSnapshot, LezerSyntaxService } = require(
    join(packageRoot, "dist", "index.js"),
);

// Families are matched against the enclosing statement's leading text, most specific first.
const FAMILIES = [
    [/\bdisk\s+(init|resize|mirror|unmirror|refit|reinit)\b/i, "legacy device (DISK INIT/RESIZE)"],
    [
        /\bload\s+(master\s+key|service\s+master\s+key|database|transaction|headeronly|filelistonly)\b/i,
        "legacy restore (LOAD)",
    ],
    [/\bdump\b/i, "legacy backup (DUMP)"],
    [/\badd\s+signature\b|\bdrop\s+signature\b/i, "module signing"],
    [/\bcryptographic\s+provider\b/i, "cryptographic provider"],
    [
        /\b(alter|create|backup|drop|open|close|restore)\s+(service\s+)?master\s+key\b/i,
        "MASTER KEY",
    ],
    [/\b(alter|create|drop)\s+(symmetric|asymmetric)\s+key\b/i, "SYMMETRIC/ASYMMETRIC KEY"],
    [/\bbackup\s+certificate\b|\b(create|alter|drop)\s+certificate\b/i, "CERTIFICATE"],
    [/\bbackup\s+(database|log)\b/i, "BACKUP DATABASE/LOG"],
    [/\brestore\b/i, "RESTORE"],
    [/\bserver\s+audit\b|\baudit\s+specification\b/i, "SQL Audit"],
    [
        /\bavailability\s+group\b|availability_mode|failover_mode|secondary_role/i,
        "availability groups",
    ],
    [/\bfederation\b/i, "FEDERATION (Azure legacy)"],
    [/\balter\s+index\b/i, "ALTER INDEX"],
    [/\bcreate\s+spatial\s+index\b/i, "spatial index"],
    [/\b(primary\s+|selective\s+)?xml\s+index\b/i, "XML index"],
    [/\bxml_compression|data_compression\b/i, "partition-scoped compression options"],
    [/\bmemory_optimized\b/i, "memory-optimized table options"],
    [/\bsystem_versioning|ledger_view|\bledger\s*=/i, "temporal/ledger table options"],
    [/\bcreate\s+(unique\s+)?(clustered\s+|nonclustered\s+)?index\b/i, "CREATE INDEX"],
    [/\balter\s+table\b/i, "ALTER TABLE"],
    [/\bcreate\s+table\b|\bconstraint\b/i, "CREATE TABLE / constraints"],
    [/\bcreate\s+type\b|\bdeclare\s+@\w+\s+table\b/i, "table types / table variables"],
    [
        /\balter\s+(remote\s+service\s+binding|route|service)\b|\b(create|drop)\s+(remote\s+service\s+binding|route|queue|contract|message\s+type|service)\b/i,
        "Service Broker DDL",
    ],
    [
        /\bto\s+service\b|\bsend\s+on\s+conversation\b|\bbegin\s+dialog\b|\bget\s+conversation\b|\breceive\b/i,
        "Service Broker DML",
    ],
    [/\bexecute\s+as\b|\brevert\b/i, "EXECUTE AS / REVERT"],
    [/\bgrant\b|\brevoke\b|\bdeny\b/i, "permissions"],
    [/\bopenrowset\b|\bprovider\s*=|\bconnection\s*=/i, "OPENROWSET / external providers"],
    [/\bwith\s+xmlnamespaces\b/i, "XMLNAMESPACES"],
    [/\bchangetable\b/i, "CHANGETABLE"],
    [/\bset\s+offsets\b/i, "SET OFFSETS"],
    [/\bset\s+\w+/i, "SET statement"],
    [/\bkill\b/i, "KILL"],
    [/\bcreate\s+(rule|default)\b/i, "legacy RULE/DEFAULT"],
    [
        /\bexternal\b|reject_value|reject_sample_value|distribution\s*=/i,
        "external / distributed tables",
    ],
    [/\bwaitfor\b/i, "WAITFOR"],
    [/\braiserror\b/i, "RAISERROR"],
    [/\bcreate\s+(proc|procedure|function|trigger|view)\b/i, "programmable objects"],
    [/\balter\s+schema\b|\bapplication\s+role\b/i, "schema / principals"],
    [/\boption\s*\(/i, "query OPTION hints"],
    [/\bupdate\b|\binsert\b|\bdelete\b|\bmerge\b/i, "DML"],
    [/\bselect\b/i, "query / SELECT"],
];

const service = new LezerSyntaxService();
const rows = [];
const nodes = [];

await collectCorpus();
await collectRealWorld();

const byClass = new Map();
const byFamily = new Map();
for (const row of rows) {
    byClass.set(row.cls, (byClass.get(row.cls) ?? 0) + row.raw);
    for (const [family, count] of row.families) {
        if (!byFamily.has(family)) {
            byFamily.set(family, { raw: 0, files: new Set(), classes: new Set() });
        }
        const bucket = byFamily.get(family);
        bucket.raw += count;
        bucket.files.add(row.path);
        bucket.classes.add(row.cls);
    }
}

const markdownIndex = process.argv.indexOf("--markdown");
if (markdownIndex >= 0) {
    await writeFile(process.argv[markdownIndex + 1], renderMarkdown(), "utf8");
}
const ledgerIndex = process.argv.indexOf("--ledger");
if (ledgerIndex >= 0) {
    await writeFile(process.argv[ledgerIndex + 1], renderLedger(), "utf8");
}
printSummary();

async function collectCorpus() {
    const root = join(packageRoot, "test", "corpus", "tsql-conformance");
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    for (const file of manifest.files) {
        const text = decode(await readFile(join(root, file.path)), file.encoding);
        const snapshot = service.parse(new ImmutableTextSnapshot(`corpus:/${file.path}`, 1, text));
        if (snapshot.statistics.rawErrorNodeCount === 0) continue;
        rows.push({
            source: "corpus",
            path: file.path,
            raw: snapshot.statistics.rawErrorNodeCount,
            cls: corpusClass(file),
            families: familiesIn(snapshot, text, {
                source: "corpus",
                path: file.path,
                cls: corpusClass(file),
            }),
        });
    }
}

async function collectRealWorld() {
    const root = join(packageRoot, "test", "fixtures", "real-world-sql");
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    for (const file of manifest.files) {
        const text = decode(await readFile(join(root, file.path)), file.encoding);
        const snapshot = service.parse(new ImmutableTextSnapshot(`rw:/${file.path}`, 1, text));
        if (snapshot.statistics.rawErrorNodeCount === 0) continue;
        // The real-world manifest declares its own expectations per fixture.
        const malformed =
            (file.expectedRawErrorNodeCount ?? 0) > 0 ||
            (file.expectedSyntaxDiagnostics ?? []).length > 0;
        const cls = malformed
            ? "intentionally malformed"
            : (file.expectedSemanticDiagnostics ?? []).length > 0
              ? "negative diagnostic fixture"
              : "valid, supported";
        rows.push({
            source: "real-world",
            path: file.path,
            raw: snapshot.statistics.rawErrorNodeCount,
            cls,
            families: familiesIn(snapshot, text, {
                source: "real-world",
                path: file.path,
                cls,
            }),
        });
    }
}

// Groups a fixture's recovery nodes by the family of the statement that encloses each one. The
// enclosing statement is far more reliable than the error line's own text, because many recovery
// nodes land on continuation lines that carry no statement keyword.
function familiesIn(snapshot, text, node) {
    const counts = new Map();
    const cursor = snapshot.tree.cursor();
    do {
        if (!cursor.type.isError) continue;
        const family = familyOfError(cursor, text);
        counts.set(family, (counts.get(family) ?? 0) + 1);
        if (node) nodes.push(ledgerRow(cursor, text, node));
    } while (cursor.next());
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

// One row per raw recovery node: where it is, what encloses it, and what token was recovered.
// Derived from the same walk as the family counts so the two can never disagree.
function ledgerRow(cursor, text, owner) {
    const before = text.slice(0, cursor.from);
    const line = before.split(/\r\n|\r|\n/u);
    const parent = cursor.node.parent;
    return {
        ...owner,
        line: line.length,
        column: (line.at(-1) ?? "").length + 1,
        from: cursor.from,
        to: cursor.to,
        parent: parent?.type.name ?? "Script",
        token: text.slice(cursor.from, cursor.to).trim() || "<empty>",
    };
}

function renderLedger() {
    let out = "# Recovery-node ledger\n\n";
    out +=
        "One row per raw recovery node. A raw node in a valid or profile-gated fixture is a\n" +
        "grammar/recovery defect candidate; a raw node in an intentionally malformed fixture is\n" +
        "recovery-shape evidence, not a grammar feature request.\n\n";
    out +=
        "Generated by `node scripts/report-fixture-inventory.mjs --ledger <path>`; regenerate after\n" +
        "any grammar change rather than editing by hand. Coordinates are one-based line and UTF-16\n" +
        "column; offsets are zero-based UTF-16 `[from,to)`. `<empty>` means a zero-width node.\n\n";
    const raw = rows.reduce((sum, row) => sum + row.raw, 0);
    out += `**Total:** ${nodes.length} rows across ${rows.length} fixtures.\n\n`;
    if (raw !== nodes.length) {
        out +=
            `The published raw-recovery-node statistic totals ${raw}. It is counted per parsed\n` +
            "chunk while this ledger enumerates the merged snapshot tree, so a node that merging\n" +
            "folds into its neighbour is listed once here. The difference is a reporting artefact,\n" +
            "not extra damaged input.\n\n";
    }
    out += "| source | fixture | class | location | offsets | parent kind | recovered token |\n";
    out += "|---|---|---|---|---:|---|---|\n";
    for (const node of [...nodes].sort(
        (left, right) =>
            left.source.localeCompare(right.source) ||
            left.path.localeCompare(right.path) ||
            left.from - right.from,
    )) {
        out +=
            `| ${node.source} | \`${node.path}\` | ${node.cls} | ${node.line}:${node.column} ` +
            `| ${node.from}-${node.to} | \`${node.parent}\` | \`${node.token}\` |\n`;
    }
    return out;
}

/** A fixture's class: its own expectation first, then whether a profile or version gates it. */
function corpusClass(file) {
    if (file.expectation === "recovery") return "intentionally malformed";
    const gated =
        (file.flavorHint && file.flavorHint !== "sql-server-or-common") || file.versionHint;
    return gated ? "valid, profile-gated" : "valid, supported";
}

function familyOfError(cursor, text) {
    for (let node = cursor.node.parent; node; node = node.parent) {
        const name = node.type.name;
        if (!name || name === "Script" || name === "Batch") break;
        if (!name.endsWith("Statement")) continue;
        const head = text.slice(node.from, Math.min(node.to, node.from + 120)).trim();
        return FAMILIES.find(([pattern]) => pattern.test(head))?.[1] ?? `other: ${name}`;
    }
    const start = text.lastIndexOf("\n", Math.max(0, cursor.from - 1)) + 1;
    const end = text.indexOf("\n", cursor.from);
    const line = text.slice(start, end < 0 ? text.length : end).trim();
    return FAMILIES.find(([pattern]) => pattern.test(line))?.[1] ?? "unclassified";
}

function renderMarkdown() {
    const total = rows.reduce((sum, row) => sum + row.raw, 0);
    let out = "# Milestone 1 fixture inventory\n\n";
    out +=
        "Generated by `node scripts/report-fixture-inventory.mjs --markdown <path>`; regenerate\n";
    out += "after any grammar change rather than editing by hand.\n\n";
    out += "Every fixture that still carries at least one raw recovery node is listed with its\n";
    out +=
        "grammar families and its fixture class. Fixtures with zero recovery nodes are omitted\n";
    out += "because they already satisfy the milestone.\n\n";
    out += `**Totals:** ${rows.length} recovery-bearing files, ${total} raw recovery nodes.\n\n`;
    out += "## By fixture class\n\n| class | raw recovery nodes | files |\n|---|---:|---:|\n";
    for (const [cls, raw] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
        out += `| ${cls} | ${raw} | ${rows.filter((row) => row.cls === cls).length} |\n`;
    }
    out +=
        "\n## By grammar family\n\n| grammar family | raw recovery nodes | files | classes present |\n|---|---:|---:|---|\n";
    for (const [family, bucket] of [...byFamily.entries()].sort((a, b) => b[1].raw - a[1].raw)) {
        out += `| ${family} | ${bucket.raw} | ${bucket.files.size} | ${[...bucket.classes].join("; ")} |\n`;
    }
    out +=
        "\n## Per fixture\n\n| fixture | source | class | raw | dominant families |\n|---|---|---|---:|---|\n";
    for (const row of [...rows].sort((a, b) => b.raw - a.raw || a.path.localeCompare(b.path))) {
        const families = row.families
            .slice(0, 3)
            .map(([family, count]) => `${family} (${count})`)
            .join("; ");
        out += `| \`${row.path}\` | ${row.source} | ${row.cls} | ${row.raw} | ${families} |\n`;
    }
    return out;
}

function printSummary() {
    const total = rows.reduce((sum, row) => sum + row.raw, 0);
    console.log(`Recovery-bearing fixtures: ${rows.length}; raw recovery nodes: ${total}`);
    console.log("By fixture class:");
    for (const [cls, raw] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(raw).padStart(5)}  ${cls}`);
    }
    console.log("Top grammar families:");
    for (const [family, bucket] of [...byFamily.entries()]
        .sort((a, b) => b[1].raw - a[1].raw)
        .slice(0, 20)) {
        console.log(
            `  ${String(bucket.raw).padStart(5)}  ${String(bucket.files.size).padStart(3)} files  ${family}`,
        );
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
