/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Observability Contract conformance: the marker/event names this extension
 * actually emits must exist in the shared registry (vendored snapshot from
 * perftest/packages/observability-contracts). If this fails you either
 * added an unregistered event (register it + regenerate + re-vendor) or the
 * snapshot is stale.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import {
    OBS_CONTRACT,
    deriveEligibility,
    explainEventName,
    lintCorrelation,
} from "../../src/sharedInterfaces/observabilityContract.generated";
import { featureFor, PERF_ATTR_CLASSIFICATION } from "../../src/perf/perfTelemetry";

const SRC_ROOT = path.join(__dirname, "..", "..", "..", "src");

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

interface EmittedMarker {
    attrs: Set<string>;
    /** Attributes whose classification is supplied by Perf.marker at runtime. */
    perfAttrs: Set<string>;
    files: Set<string>;
}

function propertyNameText(name: ts.PropertyName | undefined): string | undefined {
    if (name === undefined) {
        return undefined;
    }
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return undefined;
}

function collectObjectKeys(expression: ts.Expression | undefined, target: Set<string>): void {
    if (expression === undefined || !ts.isObjectLiteralExpression(expression)) {
        return;
    }
    for (const property of expression.properties) {
        if (!ts.isSpreadAssignment(property)) {
            const key = propertyNameText(property.name);
            if (key !== undefined) {
                target.add(key);
            }
        }
    }
}

function emittedMarkers(): Map<string, EmittedMarker> {
    const emitted = new Map<string, EmittedMarker>();
    for (const file of walk(SRC_ROOT)) {
        const source = fs.readFileSync(file, "utf8");
        const sourceFile = ts.createSourceFile(
            file,
            source,
            ts.ScriptTarget.Latest,
            true,
            file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const record = (
            name: string,
            attrsExpression?: ts.Expression,
            runtimeClassified = false,
        ): void => {
            const marker = emitted.get(name) ?? {
                attrs: new Set<string>(),
                perfAttrs: new Set<string>(),
                files: new Set<string>(),
            };
            marker.files.add(path.relative(SRC_ROOT, file));
            collectObjectKeys(attrsExpression, marker.attrs);
            if (runtimeClassified) {
                collectObjectKeys(attrsExpression, marker.perfAttrs);
            }
            emitted.set(name, marker);
        };
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)) {
                if (
                    ts.isPropertyAccessExpression(node.expression) &&
                    ts.isIdentifier(node.expression.expression) &&
                    node.expression.expression.text === "Perf" &&
                    node.expression.name.text === "marker"
                ) {
                    const name = node.arguments[0];
                    if (name !== undefined && ts.isStringLiteralLike(name)) {
                        record(name.text, node.arguments[2], true);
                    }
                } else if (
                    ts.isIdentifier(node.expression) &&
                    (node.expression.text === "perfMark" ||
                        node.expression.text === "perfMarkAfterNextPaint")
                ) {
                    const name = node.arguments[0];
                    if (name !== undefined && ts.isStringLiteralLike(name)) {
                        record(name.text, node.arguments[1], true);
                    }
                } else if (
                    ts.isPropertyAccessExpression(node.expression) &&
                    ts.isIdentifier(node.expression.expression) &&
                    node.expression.expression.text === "diag" &&
                    (node.expression.name.text === "emit" ||
                        node.expression.name.text === "startSpan")
                ) {
                    const input = node.arguments[0];
                    if (input !== undefined && ts.isObjectLiteralExpression(input)) {
                        const typeProperty = input.properties.find(
                            (property): property is ts.PropertyAssignment =>
                                ts.isPropertyAssignment(property) &&
                                propertyNameText(property.name) === "type" &&
                                ts.isStringLiteralLike(property.initializer),
                        );
                        const fieldsProperty = input.properties.find(
                            (property): property is ts.PropertyAssignment =>
                                ts.isPropertyAssignment(property) &&
                                propertyNameText(property.name) === "fields",
                        );
                        if (
                            typeProperty !== undefined &&
                            ts.isStringLiteralLike(typeProperty.initializer)
                        ) {
                            if (node.expression.name.text === "startSpan") {
                                record(
                                    `${typeProperty.initializer.text}.begin`,
                                    fieldsProperty?.initializer,
                                );
                                record(
                                    `${typeProperty.initializer.text}.end`,
                                    fieldsProperty?.initializer,
                                );
                            } else {
                                record(typeProperty.initializer.text, fieldsProperty?.initializer);
                            }
                        }
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    return emitted;
}

suite("Observability Contract conformance", () => {
    test("every literal emitted marker uses its registry feature bucket", function () {
        if (!fs.existsSync(SRC_ROOT)) {
            this.skip();
        }
        for (const name of emittedMarkers().keys()) {
            expect(featureFor(name), name).to.equal(explainEventName(name).entry?.feature);
        }
        expect(featureFor("unregistered.test.event")).to.equal("system");
    });

    test("every literal marker emitted by src/ is registered", function () {
        if (!fs.existsSync(SRC_ROOT)) {
            this.skip(); // packaged test run without sources
        }
        const emitted = emittedMarkers();
        expect(emitted.size, "no markers found — syntax collector broke?").to.be.greaterThan(8);
        const unknown = [...emitted.keys()].filter((name) => !explainEventName(name).known);
        expect(
            unknown,
            `unregistered marker names (add to the registry + regenerate):\n${unknown.join("\n")}`,
        ).to.deep.equal([]);
    });

    test("every literal marker attribute has a runtime privacy classification", function () {
        if (!fs.existsSync(SRC_ROOT)) {
            this.skip();
        }
        const missing: string[] = [];
        for (const [name, marker] of emittedMarkers()) {
            for (const attr of marker.perfAttrs) {
                if (PERF_ATTR_CLASSIFICATION[attr] === undefined) {
                    missing.push(`${name}.${attr} (${[...marker.files].join(", ")})`);
                }
            }
        }
        // Added by perfMarkAfterNextPaint rather than by an individual marker call.
        if (PERF_ATTR_CLASSIFICATION["rafThrottled"] === undefined) {
            missing.push("webview helper.rafThrottled (webviews/common/perfMarks.ts)");
        }
        expect(
            missing,
            `unclassified runtime marker attributes:\n${missing.join("\n")}`,
        ).to.deep.equal([]);
    });

    test("attrsComplete registry entries declare every emitted literal attribute", function () {
        if (!fs.existsSync(SRC_ROOT)) {
            this.skip();
        }
        const missing: string[] = [];
        for (const [name, marker] of emittedMarkers()) {
            const entry = explainEventName(name).entry;
            if (entry?.attrsComplete !== true) {
                continue;
            }
            for (const attr of marker.attrs) {
                if (entry.attrs[attr] === undefined) {
                    missing.push(`${name}.${attr}`);
                }
            }
        }
        expect(missing, `incomplete closed registry attrs:\n${missing.join("\n")}`).to.deep.equal(
            [],
        );
    });

    test("registry attr classifications resolve and sts families stay diagnostic", () => {
        for (const entry of OBS_CONTRACT.events) {
            for (const cls of Object.values(entry.attrs)) {
                expect(
                    OBS_CONTRACT.classifications[cls],
                    `${entry.name ?? entry.prefix}: classification '${cls}'`,
                ).to.not.equal(undefined);
            }
            if (entry.prefix?.startsWith("sts.")) {
                expect(entry.timingClass).to.equal("epochAligned");
                expect(entry.measurementEligible).to.equal(false);
            }
        }
    });

    test("timing honesty: the vendored eligibility function enforces the rules", () => {
        const base = {
            source: "marker",
            passType: "measurement" as const,
            environment: "interactiveHost" as const,
            timePlane: "monotonic" as const,
            repStatus: "passed" as const,
            richCollection: false,
        };
        // Self-test on an interactive host: exploratory, never CI-gating.
        const selfTest = deriveEligibility(base);
        expect(selfTest.measurementEligible).to.equal(true);
        expect(selfTest.exploratory).to.equal(true);
        expect(selfTest.ciGatingEligible).to.equal(false);
        // Epoch-aligned STS spans and rich-collection reps: diagnostic-only.
        expect(deriveEligibility({ ...base, timePlane: "epoch" }).diagnosticOnly).to.equal(true);
        expect(deriveEligibility({ ...base, richCollection: true }).diagnosticOnly).to.equal(true);
    });

    test("vendored correlation linter: registry pairing + honest scoring", () => {
        const ev = (type: string, traceId?: string, seq = 1) => ({
            seq,
            type,
            kind: "event",
            epochMs: 1000 + seq,
            process: "extensionHost",
            ...(traceId ? { traceId } : {}),
        });
        const clean = lintCorrelation([
            ev("mssql.connection.begin", "t1", 1),
            ev("mssql.connection.ready", "t1", 2),
        ]);
        expect(clean.score).to.equal("good");
        const foggy = lintCorrelation([
            ev("mssql.query.submit", undefined, 1), // orphan + unpaired
        ]);
        expect(foggy.orphanCount).to.equal(1);
        expect(foggy.unmatchedPairs.length).to.be.greaterThan(0);
        expect(foggy.score).to.not.equal("good");
    });
});
