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

export function compareBenchmarkReports(
    baseline: unknown,
    candidate: unknown,
): BenchmarkComparisonResult;
