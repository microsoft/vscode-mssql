/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISlickRange } from "../../../../sharedInterfaces/queryResult";

export interface RowRange {
    start: number;
    length: number;
}

export function tryCombineSelectionsForResults(selections: ISlickRange[]): ISlickRange[] {
    // need to take row number column in to consideration.
    return tryCombineSelections(selections).map((range) => {
        return {
            fromCell: range.fromCell - 1,
            fromRow: range.fromRow,
            toCell: range.toCell - 1,
            toRow: range.toRow,
        };
    });
}

export function selectionToRange(selection: ISlickRange): RowRange {
    let range: RowRange = {
        start: selection.fromRow,
        length: selection.toRow - selection.fromRow + 1,
    };
    return range;
}

export function tryCombineSelections(selections: ISlickRange[]): ISlickRange[] {
    if (!selections || selections.length === 0 || selections.length === 1) {
        return selections;
    }

    // If the selections combine into a single continuous selection, this will be the selection
    let unifiedSelection: ISlickRange = {
        fromCell: selections
            .map((range) => range.fromCell)
            .reduce((min, next) => (next < min ? next : min)),
        fromRow: selections
            .map((range) => range.fromRow)
            .reduce((min, next) => (next < min ? next : min)),
        toCell: selections
            .map((range) => range.toCell)
            .reduce((max, next) => (next > max ? next : max)),
        toRow: selections
            .map((range) => range.toRow)
            .reduce((max, next) => (next > max ? next : max)),
    };

    // Verify whether all cells in the combined selection have actually been selected
    let verifiers: ((cell: [number, number]) => boolean)[] = [];
    selections.forEach((range) => {
        verifiers.push((cell: [number, number]) => {
            return (
                cell[0] >= range.fromRow &&
                cell[0] <= range.toRow &&
                cell[1] >= range.fromCell &&
                cell[1] <= range.toCell
            );
        });
    });
    for (let row = unifiedSelection.fromRow; row <= unifiedSelection.toRow; row++) {
        for (let column = unifiedSelection.fromCell; column <= unifiedSelection.toCell; column++) {
            // If some cell in the combined selection isn't actually selected, return the original selections
            if (!verifiers.some((verifier) => verifier([row, column]))) {
                return selections;
            }
        }
    }
    return [unifiedSelection];
}

export function selectEntireGrid<T extends Slick.SlickData>(grid: Slick.Grid<T>): ISlickRange[] {
    const data = grid.getData() as T[];
    const totalRows = data.length;
    const totalColumns = grid.getColumns().length;

    // Create a selection for the entire grid
    return [
        {
            fromRow: 0,
            toRow: totalRows - 1,
            fromCell: 0,
            toCell: totalColumns - 2, // Subtract 2 to account for row number column and 0-based indexing
        },
    ];
}
