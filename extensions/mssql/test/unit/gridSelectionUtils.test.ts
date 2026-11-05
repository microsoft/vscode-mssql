/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { convertDisplayedSelectionRowsToActual } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridSelection";
import { ISlickRange } from "../../src/sharedInterfaces/queryResult";

suite("Grid Selection Utils", () => {
    suite("convertDisplayedSelectionRowsToActual", () => {
        test("preserves display order when sorted rows map to descending actual rows", () => {
            const actualRowIds = [4, 3, 2, 1, 0];
            const selections: ISlickRange[] = [{ fromRow: 0, toRow: 4, fromCell: 1, toCell: 2 }];

            const result = convertDisplayedSelectionRowsToActual(
                selections,
                (displayRow) => actualRowIds[displayRow],
            );

            expect(result).to.deep.equal([
                { fromRow: 4, toRow: 4, fromCell: 1, toCell: 2 },
                { fromRow: 3, toRow: 3, fromCell: 1, toCell: 2 },
                { fromRow: 2, toRow: 2, fromCell: 1, toCell: 2 },
                { fromRow: 1, toRow: 1, fromCell: 1, toCell: 2 },
                { fromRow: 0, toRow: 0, fromCell: 1, toCell: 2 },
            ]);
        });

        test("combines only ascending actual row runs in display order", () => {
            const actualRowIds = [3, 4, 5, 0, 1];
            const selections: ISlickRange[] = [{ fromRow: 0, toRow: 4, fromCell: 0, toCell: 1 }];

            const result = convertDisplayedSelectionRowsToActual(
                selections,
                (displayRow) => actualRowIds[displayRow],
            );

            expect(result).to.deep.equal([
                { fromRow: 3, toRow: 5, fromCell: 0, toCell: 1 },
                { fromRow: 0, toRow: 1, fromCell: 0, toCell: 1 },
            ]);
        });

        test("orders multiple display selections by visual row order", () => {
            const actualRowIds = [10, 20, 30, 40, 50];
            const selections: ISlickRange[] = [
                { fromRow: 3, toRow: 4, fromCell: 0, toCell: 1 },
                { fromRow: 0, toRow: 1, fromCell: 0, toCell: 1 },
            ];

            const result = convertDisplayedSelectionRowsToActual(
                selections,
                (displayRow) => actualRowIds[displayRow],
            );

            expect(result).to.deep.equal([
                { fromRow: 10, toRow: 10, fromCell: 0, toCell: 1 },
                { fromRow: 20, toRow: 20, fromCell: 0, toCell: 1 },
                { fromRow: 40, toRow: 40, fromCell: 0, toCell: 1 },
                { fromRow: 50, toRow: 50, fromCell: 0, toCell: 1 },
            ]);
        });
    });
});
