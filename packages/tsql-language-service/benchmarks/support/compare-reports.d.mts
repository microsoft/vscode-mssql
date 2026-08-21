/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface BenchmarkComparison {
    readonly name: string;
    readonly baseline: number;
    readonly candidate: number;
    readonly delta: number;
    readonly ratio: number;
    readonly regression: boolean;
}

export interface BenchmarkComparisonResult {
    readonly comparisons: readonly BenchmarkComparison[];
    readonly regressions: readonly BenchmarkComparison[];
}

export interface BenchmarkTableRow {
    readonly metric: string;
    readonly baseline?: number;
    readonly candidate: number;
    readonly delta?: number;
    readonly ratio?: number;
    readonly result: "N/A" | "pass" | "REGRESSION";
}

export function compareBenchmarkReports(
    baseline: unknown,
    candidate: unknown,
): BenchmarkComparisonResult;

export function benchmarkTableRows(
    baseline: unknown | undefined,
    candidate: unknown,
): readonly BenchmarkTableRow[];

export function formatBenchmarkMarkdown(baseline: unknown | undefined, candidate: unknown): string;
