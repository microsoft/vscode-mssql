/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LIGHT grid facts shared with the app shell (BOOT-2): everything the entry
 * chunk needs from the grid WITHOUT pulling the slickgrid stack. The heavy
 * grid module (resultsGrid.tsx) re-exports these for its own consumers —
 * nothing in this file may import slickgrid/FluentResultGrid, ever (the
 * bundle-budget test fails the suite if the grid lands back in the entry
 * closure).
 */

import { QsGridStyle } from "../../../sharedInterfaces/queryStudio";

export interface Rpc {
    sendRequest<P, R>(type: { method: string }, params: P): Promise<R>;
}

const DEFAULT_FONT_SIZE = 12;
// Compact vertical chrome around the text (SSMS-like density). Users who
// want airier rows raise mssql.resultsGrid.rowPadding.
const BASE_ROW_PADDING = 6;

/** Grid row height: fontSize + compact base chrome + 2·padding. */
export function qsGridRowHeight(gridStyle: QsGridStyle | undefined): number {
    const padding = Math.max(0, gridStyle?.rowPadding ?? 0);
    return (gridStyle?.fontSize ?? DEFAULT_FONT_SIZE) + BASE_ROW_PADDING + padding * 2;
}
