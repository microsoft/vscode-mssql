/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { analysisProfileKey, resolveAnalysisProfile } from "../common/analysisProfile.js";
import type { SyntaxNode } from "../syntax/index.js";
import { visitSyntaxTree as visit } from "../syntax/treeUtilities.js";
import type { TextRange } from "../text/index.js";
import type { BindInput, BoundUnit, SemanticSnapshot, SymbolId } from "./contracts.js";

export interface SemanticReusePlan {
    readonly units: readonly (BoundUnit | undefined)[];
    readonly incomingVersions: readonly string[];
    readonly exportedVersions: readonly string[];
}

export function semanticEnvironmentIsPositionStable(
    batches: readonly SyntaxNode[],
    plan: SemanticReusePlan,
    previous: SemanticSnapshot,
): boolean {
    return (
        batches.length === previous.units.length &&
        batches.every((batch, index) => {
            const prior = previous.units[index];
            return (
                prior !== undefined &&
                batch.start === prior.range.start &&
                batch.end === prior.range.end &&
                plan.incomingVersions[index] === prior.incomingEnvironmentVersion &&
                plan.exportedVersions[index] === prior.exportedEnvironmentVersion
            );
        })
    );
}

export function planReusableUnits(
    input: BindInput,
    batches: readonly SyntaxNode[],
    previous?: SemanticSnapshot,
): SemanticReusePlan {
    const versions = semanticEnvironmentVersions(input, batches, previous);
    const units: (BoundUnit | undefined)[] = Array.from({ length: batches.length });
    if (!previous || previous.metadataGeneration !== input.metadata.generation) {
        return { units, ...versions };
    }

    const usedPriorUnits = new Set<BoundUnit>();
    for (const [index, batch] of batches.entries()) {
        const prior = previous.units[index];
        if (
            !prior ||
            !batchIsUnchangedAtSamePosition(input, batch, prior, previous) ||
            prior.incomingEnvironmentVersion !== versions.incomingVersions[index] ||
            prior.exportedEnvironmentVersion !== versions.exportedVersions[index]
        ) {
            continue;
        }
        units[index] = prior;
        usedPriorUnits.add(prior);
    }

    const candidates = new Map<string, BoundUnit[]>();
    for (const prior of previous.units) {
        if (usedPriorUnits.has(prior)) continue;
        const key = reusableUnitKey(
            prior.range.end - prior.range.start,
            fingerprintHash(prior.syntaxFingerprint),
            prior.incomingEnvironmentVersion,
            prior.exportedEnvironmentVersion,
        );
        const queue = candidates.get(key) ?? [];
        queue.push(prior);
        candidates.set(key, queue);
    }
    for (const [index, batch] of batches.entries()) {
        if (units[index]) continue;
        const contentHash = hashSemanticText(
            input.syntax.document.text.slice(batch.start, batch.end),
        );
        const key = reusableUnitKey(
            batch.end - batch.start,
            contentHash,
            versions.incomingVersions[index]!,
            versions.exportedVersions[index]!,
        );
        const prior = candidates.get(key)?.shift();
        if (!prior) continue;
        units[index] = shiftBoundUnit(
            prior,
            batch,
            contentHash,
            versions.incomingVersions[index]!,
            versions.exportedVersions[index]!,
        );
    }
    return { units, ...versions };
}

function reusableUnitKey(
    length: number,
    contentHash: string,
    incomingEnvironmentVersion: string,
    exportedEnvironmentVersion: string,
): string {
    return `${length}:${contentHash}:${incomingEnvironmentVersion}:${exportedEnvironmentVersion}`;
}

function semanticEnvironmentVersions(
    input: BindInput,
    batches: readonly SyntaxNode[],
    previous?: SemanticSnapshot,
): {
    readonly incomingVersions: readonly string[];
    readonly exportedVersions: readonly string[];
} {
    const incomingVersions: string[] = [];
    const exportedVersions: string[] = [];
    // The analysis profile and the resolved engine profile both change which diagnostics a
    // statement produces, so both take part in the reuse key. A connection that moves a document
    // from one engine to another therefore rebinds even when its text is identical.
    let environment = `semantic:${input.metadata.generation}:${analysisProfileKey(
        resolveAnalysisProfile(input.profile),
    )}:${input.syntax.profileGeneration}`;
    for (const [index, batch] of batches.entries()) {
        incomingVersions.push(environment);
        const prior = previous?.units[index];
        if (
            previous?.metadataGeneration === input.metadata.generation &&
            prior &&
            prior.incomingEnvironmentVersion === environment &&
            batchIsUnchangedAtSamePosition(input, batch, prior, previous)
        ) {
            environment = prior.exportedEnvironmentVersion;
            exportedVersions.push(environment);
            continue;
        }
        const exported = semanticExportFingerprint(input.syntax, batch);
        if (exported)
            environment = `semantic:${input.metadata.generation}:${hashSemanticText(`${environment}\0${exported}`)}`;
        exportedVersions.push(environment);
    }
    return { incomingVersions, exportedVersions };
}

function batchIsUnchangedAtSamePosition(
    input: BindInput,
    batch: SyntaxNode,
    prior: BoundUnit,
    previous: SemanticSnapshot,
): boolean {
    if (batch.start !== prior.range.start || batch.end !== prior.range.end) return false;
    if (input.syntax.document.version === previous.documentVersion) return true;
    if (!input.changedRanges) return false;
    return input.changedRanges.every((range) => !rangesIntersect(range, batch));
}

function rangesIntersect(left: TextRange, right: TextRange): boolean {
    if (left.start === left.end) return right.start <= left.start && left.start <= right.end;
    return left.start < right.end && right.start < left.end;
}

function semanticExportFingerprint(syntax: BindInput["syntax"], batch: SyntaxNode): string {
    const exports: string[] = [];
    visit(batch, (node) => {
        if (
            node.kind === "UseStatement" ||
            node.kind === "IntoClause" ||
            /^(?:Create|Alter|Drop).+Statement$/u.test(node.kind)
        ) {
            exports.push(
                `${node.kind}:${node.start - batch.start}:${hashSemanticText(
                    syntax.document.text.slice(node.start, node.end),
                )}`,
            );
        }
    });
    return exports.length === 0 ? "" : hashSemanticText(exports.join("\0"));
}

function fingerprintHash(fingerprint: string): string {
    return fingerprint.slice(fingerprint.lastIndexOf(":") + 1);
}

function shiftBoundUnit(
    unit: BoundUnit,
    batch: SyntaxNode,
    contentHash: string,
    incomingEnvironmentVersion: string,
    exportedEnvironmentVersion: string,
): BoundUnit {
    const delta = batch.start - unit.range.start;
    if (
        delta === 0 &&
        unit.incomingEnvironmentVersion === incomingEnvironmentVersion &&
        unit.exportedEnvironmentVersion === exportedEnvironmentVersion
    ) {
        return unit;
    }
    const shiftId = (id: SymbolId): SymbolId => shiftSymbolId(id, unit.range.start, delta);
    const symbols = unit.symbols.map((symbol) =>
        Object.freeze({
            ...symbol,
            id: shiftId(symbol.id),
            ...(symbol.declaration ? { declaration: shiftRange(symbol.declaration, delta) } : {}),
        }),
    );
    const references = unit.references.map((reference) =>
        Object.freeze({
            ...reference,
            start: reference.start + delta,
            end: reference.end + delta,
            ...(reference.symbol ? { symbol: shiftId(reference.symbol) } : {}),
        }),
    );
    const diagnostics = unit.diagnostics.map((diagnostic) =>
        Object.freeze({
            ...diagnostic,
            range: shiftRange(diagnostic.range, delta),
        }),
    );
    return Object.freeze({
        ...unit,
        range: Object.freeze({ start: batch.start, end: batch.end }),
        syntaxFingerprint: `${batch.start}:${batch.end}:${contentHash}`,
        incomingEnvironmentVersion,
        exportedEnvironmentVersion,
        symbols: Object.freeze(symbols),
        references: Object.freeze(references),
        diagnostics: Object.freeze(diagnostics),
    });
}

function shiftSymbolId(id: SymbolId, oldBatchStart: number, delta: number): SymbolId {
    const batchScoped = /^(variable|cte|local-table):(\d+):/u.exec(id);
    if (batchScoped && Number(batchScoped[2]) === oldBatchStart) {
        return `${batchScoped[1]}:${oldBatchStart + delta}:${id.slice(batchScoped[0].length)}`;
    }
    const positionScoped = /^(alias|rowset):(\d+):/u.exec(id);
    if (positionScoped) {
        return `${positionScoped[1]}:${Number(positionScoped[2]) + delta}:${id.slice(positionScoped[0].length)}`;
    }
    return id;
}

function shiftRange(range: TextRange, delta: number): TextRange {
    return Object.freeze({ start: range.start + delta, end: range.end + delta });
}

export function hashSemanticText(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}
