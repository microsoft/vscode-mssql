/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Results-grid styling settings (classic parity). Reads mssql.resultsFontFamily,
 * mssql.resultsFontSize (compact 12px default) and the mssql.resultsGrid.*
 * settings into the validated QsGridStyle snapshot that rides QsState. Pure
 * reader (the sessionOptions.readQuerySessionOptions pattern) so the
 * validation logic is unit-testable without a live configuration.
 */

import { QsGridLinesMode, QsGridStyle } from "../sharedInterfaces/queryStudio";

/** Raw configuration reader — vscode.WorkspaceConfiguration.get shape. */
type ConfigReader = <T>(key: string) => T | undefined;

const GRID_LINE_MODES: readonly QsGridLinesMode[] = ["both", "horizontal", "vertical", "none"];

/** Classic default for mssql.resultsGrid.inMemoryDataProcessingThreshold. */
const DEFAULT_IN_MEMORY_THRESHOLD = 5000;

/** Default grid font size (px) — compact, SSMS-like density. */
const DEFAULT_GRID_FONT_SIZE = 12;

/** Read + validate the grid styling settings; invalid values fall back. */
export function readGridStyle(get: ConfigReader): QsGridStyle {
    const fontFamilyRaw = get<unknown>("mssql.resultsFontFamily");
    const fontFamily =
        typeof fontFamilyRaw === "string" && fontFamilyRaw.trim().length > 0
            ? fontFamilyRaw
            : undefined;
    // Dense by default: the grid does NOT inherit editor.fontSize (14) —
    // SSMS-style density wants a smaller grid face. mssql.resultsFontSize
    // still overrides for users who want it bigger.
    const fontSize =
        positiveNumber(get<unknown>("mssql.resultsFontSize")) ?? DEFAULT_GRID_FONT_SIZE;
    const gridLinesRaw = get<unknown>("mssql.resultsGrid.showGridLines");
    const showGridLines = GRID_LINE_MODES.find((mode) => mode === gridLinesRaw) ?? "both";
    const rowPadding = nonNegativeNumber(get<unknown>("mssql.resultsGrid.rowPadding"));
    const inMemoryThreshold = positiveNumber(
        get<unknown>("mssql.resultsGrid.inMemoryDataProcessingThreshold"),
    );
    return {
        ...(fontFamily !== undefined ? { fontFamily } : {}),
        ...(fontSize !== undefined ? { fontSize } : {}),
        alternatingRowColors: get<unknown>("mssql.resultsGrid.alternatingRowColors") === true,
        showGridLines,
        ...(rowPadding !== undefined ? { rowPadding } : {}),
        inMemoryDataProcessingThreshold: inMemoryThreshold ?? DEFAULT_IN_MEMORY_THRESHOLD,
    };
}

function positiveNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
