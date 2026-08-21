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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

import {
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
    isSqlEngineProfile,
    resolveTsqlFeatureProfile,
    type InMemoryMetadataInput,
    type MetadataSection,
    type SqlEngineProfile,
    type SyntaxDiagnostic,
    type SyntaxNode,
    type SyntaxSnapshot,
    type TsqlFeatureProfile,
} from "../../../../src/index.ts";

const inventoryRoot = join(__dirname, "..", "..", "..", "resources", "dialect");

export type DialectClassification = "valid" | "unsupportedProfile" | "invalid" | "incomplete";
export type DialectInventoryDecision = "covered" | "missing" | "outOfScope" | "duplicate";

interface CompletionExpectation {
    readonly offset: number;
    readonly includes?: readonly string[];
    readonly excludes?: readonly string[];
}

interface TextExpectation {
    readonly offset: number;
    readonly contains?: string;
    readonly absent?: boolean;
}

interface DefinitionExpectation {
    readonly offset: number;
    readonly object?: string;
    readonly local?: boolean;
}

interface ColoringExpectation {
    readonly tokens: readonly {
        readonly text: string;
        readonly tokenType: string;
    }[];
}

interface EditorExpectations {
    readonly completion?: readonly CompletionExpectation[];
    readonly hover?: readonly TextExpectation[];
    readonly signature?: readonly TextExpectation[];
    readonly definition?: readonly DefinitionExpectation[];
    readonly coloring?: true | ColoringExpectation;
}

export interface DialectScenario {
    readonly id: string;
    readonly profile: SqlEngineProfile;
    readonly serverMajorVersion?: number;
    readonly compatibilityLevel?: number;
    readonly previewFeatures?: boolean;
    readonly family: string;
    readonly classification: DialectClassification;
    readonly sql: string;
    readonly expectFeatures?: readonly string[];
    readonly expectNodes?: readonly string[];
    readonly rejectNodes?: readonly string[];
    readonly expectSpans?: readonly string[];
    readonly expectSyntax?: readonly SyntaxDiagnostic[];
    readonly incremental?: "equivalent" | "skip";
    readonly metadataSections?: readonly MetadataSection[];
    readonly editor?: EditorExpectations;
    readonly source: string;
    readonly provenance: "independently authored";
}

export interface DialectManifest {
    readonly schemaVersion: 1;
    readonly description: string;
    readonly classifications: Readonly<Record<DialectClassification, string>>;
    readonly scenarios: readonly DialectScenario[];
}

export interface ScriptDomFamily {
    readonly script: string;
    readonly decision: DialectInventoryDecision;
    readonly scenarioPrefixes?: readonly string[];
    readonly scenarioIds?: readonly string[];
    readonly note: string;
    readonly profiles?: readonly SqlEngineProfile[];
}

export interface ScriptDomFamilyInventory {
    readonly schemaVersion: 1;
    readonly description: string;
    readonly families: readonly ScriptDomFamily[];
}

export interface DialectInventory {
    readonly families: ScriptDomFamilyInventory;
    readonly manifest: DialectManifest;
}

export interface DialectScenarioOutcome {
    readonly id: string;
    readonly profile: SqlEngineProfile;
    readonly classification: DialectClassification;
    readonly family: string;
    readonly failures: readonly string[];
    readonly rawErrors: number;
    readonly availabilityDiagnostics: number;
    readonly editorKinds: readonly string[];
    readonly checks: {
        readonly structure: boolean;
        readonly incremental: boolean;
        readonly editor: boolean;
    };
}

/** The catalog every scenario that asks for metadata is answered from. */
export const catalog = Object.freeze({
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
} satisfies InMemoryMetadataInput);

/** The inventory: the ScriptDOM denominator and every authored scenario. */
export function loadDialectInventory() {
    return {
        families: parseFamilyInventory(
            readFileSync(join(inventoryRoot, "scriptdom-families.json"), "utf8"),
        ),
        manifest: parseDialectManifest(
            readFileSync(join(inventoryRoot, "dialect-scenarios.json"), "utf8"),
        ),
    };
}

export function profileOf(scenario: DialectScenario): TsqlFeatureProfile {
    return resolveTsqlFeatureProfile({
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

export function metadataProviderFor(scenario: DialectScenario) {
    if (!scenario.metadataSections || scenario.metadataSections.length === 0) {
        return new NullMetadataProvider();
    }
    const provider = new InMemoryMetadataProvider();
    provider.replace(catalog);
    return provider;
}

function collectNodeNames(snapshot: SyntaxSnapshot): ReadonlySet<string> {
    const names = new Set<string>();
    const walk = (node: SyntaxNode) => {
        names.add(node.kind);
        for (const child of node.children()) walk(child);
    };
    walk(snapshot.root());
    return names;
}

/** A range-sensitive public-tree identity; sets of names cannot detect wrong nesting or spans. */
function structuralFingerprint(snapshot: SyntaxSnapshot): string {
    const result: string[] = [];
    const walk = (node: SyntaxNode, depth: number) => {
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
export async function runScenario(scenario: DialectScenario): Promise<DialectScenarioOutcome> {
    const failures: string[] = [];
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

    const availability = snapshot.diagnostics.filter(isAvailabilityDiagnostic);
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
        const initial = first < 0 ? "" : scenario.sql.slice(first, first + 1);
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

    const editorFailures = scenario.editor
        ? await runEditorChecks(scenario, scenario.editor, profile, uri)
        : [];
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

async function runEditorChecks(
    scenario: DialectScenario,
    editor: EditorExpectations,
    profile: TsqlFeatureProfile,
    uri: string,
): Promise<readonly string[]> {
    const failures: string[] = [];
    const metadata = metadataProviderFor(scenario);
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(undefined, profile),
        new CatalogSemanticBinder(),
        metadata,
    );
    const snapshot = await runtime.open(uri, 1, scenario.sql);
    const features = new TsqlLanguageFeatureService(runtime, metadata);
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

function failed(scenario: DialectScenario, failures: readonly string[]): DialectScenarioOutcome {
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

function isAvailabilityDiagnostic(diagnostic: SyntaxDiagnostic): diagnostic is SyntaxDiagnostic & {
    readonly availability: NonNullable<SyntaxDiagnostic["availability"]>;
} {
    return (
        diagnostic.code === featureAvailabilityDiagnosticCode &&
        diagnostic.availability !== undefined
    );
}

function parseDialectManifest(source: string): DialectManifest {
    const value: unknown = JSON.parse(source);
    assertRecord(value);
    assert.equal(value.schemaVersion, 1);
    assertString(value.description);
    assertClassificationDescriptions(value.classifications);
    assert.ok(Array.isArray(value.scenarios));
    value.scenarios.forEach(assertDialectScenario);
    return {
        schemaVersion: 1,
        description: value.description,
        classifications: value.classifications,
        scenarios: value.scenarios,
    };
}

function parseFamilyInventory(source: string): ScriptDomFamilyInventory {
    const value: unknown = JSON.parse(source);
    assertRecord(value);
    assert.equal(value.schemaVersion, 1);
    assertString(value.description);
    assert.ok(Array.isArray(value.families));
    value.families.forEach(assertScriptDomFamily);
    return { schemaVersion: 1, description: value.description, families: value.families };
}

function assertDialectScenario(value: unknown): asserts value is DialectScenario {
    assertRecord(value);
    assertString(value.id);
    assert.ok(isSqlEngineProfile(value.profile), `${value.id}: invalid profile`);
    assertOptionalNumber(value.serverMajorVersion);
    assertOptionalNumber(value.compatibilityLevel);
    assertOptionalBoolean(value.previewFeatures);
    assertString(value.family);
    assert.ok(isDialectClassification(value.classification), `${value.id}: invalid classification`);
    assertString(value.sql);
    assertOptionalStringArray(value.expectFeatures);
    assertOptionalStringArray(value.expectNodes);
    assertOptionalStringArray(value.rejectNodes);
    assertOptionalStringArray(value.expectSpans);
    assertOptionalSyntaxDiagnostics(value.expectSyntax);
    assert.ok(
        value.incremental === undefined ||
            value.incremental === "equivalent" ||
            value.incremental === "skip",
        `${value.id}: invalid incremental mode`,
    );
    assertOptionalMetadataSections(value.metadataSections);
    assertOptionalEditorExpectations(value.editor);
    assertString(value.source);
    assert.equal(value.provenance, "independently authored", value.id);
}

function assertScriptDomFamily(value: unknown): asserts value is ScriptDomFamily {
    assertRecord(value);
    assertString(value.script);
    assert.ok(isInventoryDecision(value.decision), `${value.script}: invalid decision`);
    assertOptionalStringArray(value.scenarioPrefixes);
    assertOptionalStringArray(value.scenarioIds);
    assertString(value.note);
    assertOptionalEngineProfiles(value.profiles, value.script);
}

function assertClassificationDescriptions(
    value: unknown,
): asserts value is Readonly<Record<DialectClassification, string>> {
    assertRecord(value);
    for (const classification of [
        "valid",
        "unsupportedProfile",
        "invalid",
        "incomplete",
    ] as const) {
        assertString(value[classification]);
    }
}

function assertOptionalEditorExpectations(
    value: unknown,
): asserts value is EditorExpectations | undefined {
    if (value === undefined) return;
    assertRecord(value);
    assertOptionalExpectationArray(value.completion, assertCompletionExpectation);
    assertOptionalExpectationArray(value.hover, assertTextExpectation);
    assertOptionalExpectationArray(value.signature, assertTextExpectation);
    assertOptionalExpectationArray(value.definition, assertDefinitionExpectation);
    if (value.coloring !== undefined && value.coloring !== true) {
        assertColoringExpectation(value.coloring);
    }
}

function assertCompletionExpectation(value: unknown): asserts value is CompletionExpectation {
    assertRecord(value);
    assertNumber(value.offset);
    assertOptionalStringArray(value.includes);
    assertOptionalStringArray(value.excludes);
}

function assertTextExpectation(value: unknown): asserts value is TextExpectation {
    assertRecord(value);
    assertNumber(value.offset);
    assertOptionalString(value.contains);
    assertOptionalBoolean(value.absent);
}

function assertDefinitionExpectation(value: unknown): asserts value is DefinitionExpectation {
    assertRecord(value);
    assertNumber(value.offset);
    assertOptionalString(value.object);
    assertOptionalBoolean(value.local);
}

function assertColoringExpectation(value: unknown): asserts value is ColoringExpectation {
    assertRecord(value);
    assert.ok(Array.isArray(value.tokens));
    for (const token of value.tokens) {
        assertRecord(token);
        assertString(token.text);
        assertString(token.tokenType);
    }
}

function assertOptionalExpectationArray<T>(
    value: unknown,
    assertEntry: (entry: unknown) => asserts entry is T,
): asserts value is readonly T[] | undefined {
    if (value === undefined) return;
    assert.ok(Array.isArray(value));
    value.forEach(assertEntry);
}

function assertOptionalSyntaxDiagnostics(
    value: unknown,
): asserts value is readonly SyntaxDiagnostic[] | undefined {
    if (value === undefined) return;
    assert.ok(Array.isArray(value));
    for (const diagnostic of value) {
        assertRecord(diagnostic);
        assertString(diagnostic.code);
        assertString(diagnostic.message);
        assert.ok(
            diagnostic.severity === "error" ||
                diagnostic.severity === "warning" ||
                diagnostic.severity === "information",
        );
        assertTextRange(diagnostic.range);
    }
}

function assertTextRange(
    value: unknown,
): asserts value is { readonly start: number; readonly end: number } {
    assertRecord(value);
    assertNumber(value.start);
    assertNumber(value.end);
}

function assertOptionalMetadataSections(
    value: unknown,
): asserts value is readonly MetadataSection[] | undefined {
    if (value === undefined) return;
    assert.ok(Array.isArray(value));
    const sections: readonly MetadataSection[] = [
        "schemas",
        "objects",
        "columns",
        "parameters",
        "principals",
        "securables",
        "collations",
        "databases",
        "indexes",
        "triggers",
        "constraints",
        "clrTypes",
        "definitions",
    ];
    assert.ok(value.every((entry) => sections.includes(entry)));
}

function assertOptionalEngineProfiles(
    value: unknown,
    script: string,
): asserts value is readonly SqlEngineProfile[] | undefined {
    if (value === undefined) return;
    assert.ok(Array.isArray(value));
    assert.ok(value.every(isSqlEngineProfile), `${script}: invalid profile`);
}

function isDialectClassification(value: unknown): value is DialectClassification {
    return (
        value === "valid" ||
        value === "unsupportedProfile" ||
        value === "invalid" ||
        value === "incomplete"
    );
}

function isInventoryDecision(value: unknown): value is DialectInventoryDecision {
    return (
        value === "covered" ||
        value === "missing" ||
        value === "outOfScope" ||
        value === "duplicate"
    );
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
    assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
}

function assertString(value: unknown): asserts value is string {
    assert.equal(typeof value, "string");
}

function assertOptionalString(value: unknown): asserts value is string | undefined {
    assert.ok(value === undefined || typeof value === "string");
}

function assertNumber(value: unknown): asserts value is number {
    assert.equal(typeof value, "number");
}

function assertOptionalNumber(value: unknown): asserts value is number | undefined {
    assert.ok(value === undefined || typeof value === "number");
}

function assertOptionalBoolean(value: unknown): asserts value is boolean | undefined {
    assert.ok(value === undefined || typeof value === "boolean");
}

function assertStringArray(value: unknown): asserts value is readonly string[] {
    assert.ok(Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function assertOptionalStringArray(value: unknown): asserts value is readonly string[] | undefined {
    if (value !== undefined) assertStringArray(value);
}
