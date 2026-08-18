/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runs the dialect readiness inventory.
 *
 * One module is shared by the offline test lane and the readiness reporter, so a total the report
 * prints is produced by exactly the code the tests assert on. Nothing here contacts a server:
 * a scenario that needs catalog facts declares them and is answered from the in-memory provider.
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
    applyTextChanges,
    featureAvailabilityDiagnosticCode,
} = require("../../dist/index.js");

const inventoryRoot = join(__dirname, "..", "dialect");

/** The catalog every scenario that asks for metadata is answered from. */
const catalog = Object.freeze({
    environment: {
        currentDatabase: "warehouse",
        defaultSchema: "dbo",
        caseSensitive: false,
    },
    schemas: [{ name: "dbo" }, { name: "sales" }],
    objects: [
        { ref: { id: "1" }, schema: "dbo", name: "Customers", kind: "table" },
        { ref: { id: "2" }, schema: "sales", name: "Orders", kind: "table" },
        { ref: { id: "3" }, schema: "dbo", name: "Models", kind: "table" },
    ],
    columns: new Map([
        [
            "1",
            [
                { name: "CustomerID", typeDisplay: "int", nullable: false },
                { name: "Name", typeDisplay: "nvarchar(100)", nullable: true },
            ],
        ],
        [
            "2",
            [
                { name: "OrderID", typeDisplay: "int", nullable: false },
                { name: "CustomerID", typeDisplay: "int", nullable: false },
            ],
        ],
        ["3", [{ name: "Model", typeDisplay: "varbinary(max)", nullable: true }]],
    ]),
});

/** The inventory: the ScriptDOM denominator and every authored scenario. */
function loadDialectInventory() {
    return {
        families: JSON.parse(
            readFileSync(join(inventoryRoot, "inventory", "scriptdom-families.json"), "utf8"),
        ),
        manifest: JSON.parse(
            readFileSync(join(inventoryRoot, "manifest", "dialect-scenarios.json"), "utf8"),
        ),
    };
}

function profileOf(scenario) {
    return Object.freeze({
        engineProfile: scenario.profile,
        ...(scenario.serverMajorVersion === undefined
            ? {}
            : { serverMajorVersion: scenario.serverMajorVersion }),
        ...(scenario.compatibilityLevel === undefined
            ? {}
            : { compatibilityLevel: scenario.compatibilityLevel }),
        previewFeatures: scenario.previewFeatures === true,
    });
}

function metadataProviderFor(scenario) {
    if (!scenario.metadataSections || scenario.metadataSections.length === 0) {
        return new NullMetadataProvider();
    }
    const provider = new InMemoryMetadataProvider();
    provider.replace(catalog);
    return provider;
}

function collectNodeNames(snapshot) {
    const names = new Set();
    const walk = (node) => {
        names.add(node.kind);
        for (const child of node.children()) walk(child);
    };
    walk(snapshot.root());
    return names;
}

/** A range-sensitive public-tree identity; sets of names cannot detect wrong nesting or spans. */
function structuralFingerprint(snapshot) {
    const result = [];
    const walk = (node, depth) => {
        result.push(`${depth}:${node.kind}:${node.start}:${node.end}:${node.error ? 1 : 0}`);
        for (const child of node.children()) walk(child, depth + 1);
    };
    walk(snapshot.root(), 0);
    return result.join("|");
}

/**
 * Runs one scenario and returns its outcome.
 *
 * The outcome never throws: a failing scenario is reported as failing so the readiness report can
 * total it, and the test lane turns the same outcome into an assertion.
 */
async function runScenario(scenario) {
    const failures = [];
    const uri = `dialect:/${scenario.id}.sql`;
    const profile = profileOf(scenario);
    const service = new LezerSyntaxService(undefined, profile);
    const document = new ImmutableTextSnapshot(uri, 1, scenario.sql);
    let snapshot;
    try {
        snapshot = service.parse(document);
    } catch (error) {
        return failed(scenario, [`parsing threw: ${String(error)}`]);
    }

    const availability = snapshot.diagnostics.filter(
        (diagnostic) => diagnostic.code === featureAvailabilityDiagnosticCode,
    );
    const syntaxErrors = snapshot.diagnostics.filter(
        (diagnostic) => diagnostic.code !== featureAvailabilityDiagnosticCode,
    );

    // Every scenario, whatever its classification, must keep its ranges inside the document.
    for (const diagnostic of snapshot.diagnostics) {
        if (
            diagnostic.range.start < 0 ||
            diagnostic.range.end > scenario.sql.length ||
            diagnostic.range.end < diagnostic.range.start
        ) {
            failures.push(`diagnostic range ${JSON.stringify(diagnostic.range)} is out of bounds`);
        }
    }

    if (scenario.classification === "valid" || scenario.classification === "unsupportedProfile") {
        if (snapshot.statistics.rawErrorNodeCount !== 0) {
            failures.push(
                `expected no raw recovery, found ${snapshot.statistics.rawErrorNodeCount}`,
            );
        }
        if (syntaxErrors.length > 0) {
            failures.push(
                `expected no syntax diagnostic, found ${syntaxErrors
                    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
                    .join("; ")}`,
            );
        }
    }
    if (scenario.classification === "valid" && availability.length > 0) {
        failures.push(
            `expected no availability diagnostic, found ${availability
                .map((diagnostic) => diagnostic.availability.featureId)
                .join(", ")}`,
        );
    }
    if (scenario.classification === "unsupportedProfile") {
        const expected = scenario.expectFeatures ?? [];
        const produced = availability.map((diagnostic) => diagnostic.availability.featureId);
        if (JSON.stringify(produced) !== JSON.stringify(expected)) {
            failures.push(
                `expected availability features ${JSON.stringify(expected)}, found ${JSON.stringify(produced)}`,
            );
        }
        for (const diagnostic of availability) {
            if (
                scenario.sql.slice(diagnostic.range.start, diagnostic.range.end).trim().length === 0
            ) {
                failures.push(
                    `availability diagnostic underlines nothing at ${diagnostic.range.start}`,
                );
            }
        }
    }
    if (scenario.classification === "invalid") {
        if (syntaxErrors.length === 0) failures.push("expected at least one syntax diagnostic");
        if (scenario.expectSyntax === undefined) {
            failures.push("invalid scenario has no exact expectSyntax evidence");
        } else if (JSON.stringify(syntaxErrors) !== JSON.stringify(scenario.expectSyntax)) {
            failures.push(
                `expected syntax diagnostics ${JSON.stringify(scenario.expectSyntax)}, found ${JSON.stringify(syntaxErrors)}`,
            );
        }
    }
    for (const [index, span] of (scenario.expectSpans ?? []).entries()) {
        const diagnostic = availability[index];
        if (!diagnostic) {
            failures.push(`expected an availability diagnostic at index ${index}`);
            continue;
        }
        const text = scenario.sql.slice(diagnostic.range.start, diagnostic.range.end);
        if (text.toUpperCase() !== span.toUpperCase()) {
            failures.push(`expected span ${JSON.stringify(span)}, found ${JSON.stringify(text)}`);
        }
    }

    const nodes = collectNodeNames(snapshot);
    for (const expected of scenario.expectNodes ?? []) {
        if (!nodes.has(expected)) failures.push(`expected grammar node ${expected}`);
    }
    for (const forbidden of scenario.rejectNodes ?? []) {
        if (nodes.has(forbidden)) failures.push(`grammar node ${forbidden} should not appear`);
    }

    // Full and incremental results must agree after edits at the beginning, middle, and end. A
    // single append cannot exercise token or statement boundaries inside the dialect construct.
    let incrementalOk = true;
    if (scenario.incremental !== "skip") {
        const first = scenario.sql.search(/\S/u);
        const initial = first < 0 ? "" : scenario.sql[first];
        const edits = [
            ...(first < 0
                ? []
                : [
                      {
                          name: "start",
                          change: {
                              start: first,
                              end: first + 1,
                              text:
                                  initial.toUpperCase() === initial
                                      ? initial.toLowerCase()
                                      : initial.toUpperCase(),
                          },
                      },
                  ]),
            {
                name: "middle",
                change: {
                    start: Math.floor(scenario.sql.length / 2),
                    end: Math.floor(scenario.sql.length / 2),
                    text: " ",
                },
            },
            {
                name: "end",
                change: {
                    start: scenario.sql.length,
                    end: scenario.sql.length,
                    text: "\nSELECT 1;",
                },
            },
        ];
        for (const [index, edit] of edits.entries()) {
            const nextDocument = applyTextChanges(document, index + 2, [edit.change]);
            const incremental = service.update(snapshot, nextDocument, [edit.change]);
            const fresh = service.parse(nextDocument);
            if (JSON.stringify(incremental.diagnostics) !== JSON.stringify(fresh.diagnostics)) {
                failures.push(`${edit.name} incremental diagnostics differ from a fresh parse`);
                incrementalOk = false;
            }
            if (
                incremental.statistics.rawErrorNodeCount !== fresh.statistics.rawErrorNodeCount ||
                structuralFingerprint(incremental) !== structuralFingerprint(fresh) ||
                JSON.stringify([...incremental.tokens()]) !== JSON.stringify([...fresh.tokens()])
            ) {
                failures.push(`${edit.name} incremental structure differs from a fresh parse`);
                incrementalOk = false;
            }
        }
    }

    const editorFailures = scenario.editor ? await runEditorChecks(scenario, profile, uri) : [];
    failures.push(...editorFailures);

    return {
        id: scenario.id,
        profile: scenario.profile,
        classification: scenario.classification,
        family: scenario.family,
        failures,
        rawErrors: snapshot.statistics.rawErrorNodeCount,
        availabilityDiagnostics: availability.length,
        editorKinds: Object.keys(scenario.editor ?? {}),
        checks: {
            structure: snapshot.statistics.rawErrorNodeCount === 0,
            incremental: incrementalOk,
            editor: editorFailures.length === 0,
        },
    };
}

async function runEditorChecks(scenario, profile, uri) {
    const failures = [];
    const metadata = metadataProviderFor(scenario);
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(undefined, profile),
        new CatalogSemanticBinder(),
        metadata,
    );
    const snapshot = await runtime.open(uri, 1, scenario.sql);
    const features = new TsqlLanguageFeatureService(runtime, metadata);
    const editor = scenario.editor;

    for (const expectation of editor.completion ?? []) {
        const result = features.completion(uri, 1, expectation.offset);
        const labels = result.items.map((item) => item.label.toUpperCase());
        for (const included of expectation.includes ?? []) {
            if (!labels.includes(included.toUpperCase())) {
                failures.push(`completion at ${expectation.offset} is missing ${included}`);
            }
        }
        for (const excluded of expectation.excludes ?? []) {
            if (labels.includes(excluded.toUpperCase())) {
                failures.push(`completion at ${expectation.offset} still offers ${excluded}`);
            }
        }
        // Two items may share a label when their kinds differ — a column named NAME and the
        // contextual keyword are both legitimate. A duplicate is the same label in the same kind.
        const identities = result.items.map((item) => `${item.kind} ${item.label}`);
        if (new Set(identities).size !== identities.length) {
            failures.push(`completion at ${expectation.offset} returned duplicates`);
        }
    }

    for (const expectation of editor.hover ?? []) {
        const result = features.hover(uri, 1, expectation.offset);
        const markdown = result?.markdown ?? "";
        if (expectation.contains && !markdown.includes(expectation.contains)) {
            failures.push(
                `hover at ${expectation.offset} does not mention ${JSON.stringify(expectation.contains)}: ${JSON.stringify(markdown.slice(0, 120))}`,
            );
        }
        if (expectation.absent === true && result !== undefined) {
            failures.push(`hover at ${expectation.offset} answered when it should not`);
        }
    }

    for (const expectation of editor.signature ?? []) {
        const result = features.signatureHelp(uri, 1, expectation.offset);
        const label = result?.signatures?.[0]?.label ?? "";
        if (expectation.contains && !label.includes(expectation.contains)) {
            failures.push(`signature help at ${expectation.offset} is ${JSON.stringify(label)}`);
        }
    }

    for (const expectation of editor.definition ?? []) {
        const target = features.definitionTarget(uri, 1, expectation.offset);
        const object = target.object;
        const written = object ? `${object.schema}.${object.name}` : "";
        if (expectation.object && written.toLowerCase() !== expectation.object.toLowerCase()) {
            failures.push(
                `definition at ${expectation.offset} resolved to ${JSON.stringify(written)}`,
            );
        }
        if (expectation.local === true && target.locations.length === 0) {
            failures.push(`definition at ${expectation.offset} found no local declaration`);
        }
    }

    if (editor.coloring) {
        const coloring = new TsqlColorizationService();
        const full = coloring.provideDocumentColors(snapshot);
        if (full.tokens.length === 0) failures.push("coloring produced no tokens");
        if (editor.coloring === true) {
            failures.push("coloring has only a smoke expectation; declare exact tokens");
        } else {
            for (const expectation of editor.coloring.tokens ?? []) {
                const token = full.tokens.find(
                    (candidate) =>
                        scenario.sql.slice(candidate.start, candidate.end) === expectation.text &&
                        candidate.tokenType === expectation.tokenType,
                );
                if (!token) {
                    failures.push(
                        `coloring has no ${expectation.tokenType} token for ${JSON.stringify(expectation.text)}`,
                    );
                }
            }
        }
        // A whole-document range must agree with the full result, and a delta over no change must
        // reuse it, so a profile change cannot leave the three outputs disagreeing.
        const ranged = coloring.provideRangeColors({
            ...snapshot,
            range: { start: 0, end: scenario.sql.length },
        });
        if (JSON.stringify(ranged.tokens) !== JSON.stringify(full.tokens)) {
            failures.push(
                `range coloring produced ${ranged.tokens.length} tokens against ${full.tokens.length} full tokens`,
            );
        }
        const delta = coloring.provideColorEdits(full, snapshot, []);
        if (delta.kind === "delta" && delta.edits.length !== 0) {
            failures.push("an unchanged document produced coloring edits");
        }
    }

    await runtime.close(uri);
    return failures;
}

function failed(scenario, failures) {
    return {
        id: scenario.id,
        profile: scenario.profile,
        classification: scenario.classification,
        family: scenario.family,
        failures,
        rawErrors: Number.NaN,
        availabilityDiagnostics: 0,
        editorKinds: Object.keys(scenario.editor ?? {}),
        checks: { structure: false, incremental: false, editor: false },
    };
}

module.exports = {
    catalog,
    loadDialectInventory,
    metadataProviderFor,
    profileOf,
    runScenario,
};
