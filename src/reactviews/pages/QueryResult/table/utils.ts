/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ISlickRange {
    fromCell: number;
    fromRow: number;
    toCell: number;
    toRow: number;
}

export function tryCombineSelectionsForResults(
    selections: ISlickRange[],
): ISlickRange[] {
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
    for (
        let row = unifiedSelection.fromRow;
        row <= unifiedSelection.toRow;
        row++
    ) {
        for (
            let column = unifiedSelection.fromCell;
            column <= unifiedSelection.toCell;
            column++
        ) {
            // If some cell in the combined selection isn't actually selected, return the original selections
            if (!verifiers.some((verifier) => verifier([row, column]))) {
                return selections;
            }
        }
    }
    return [unifiedSelection];
}
