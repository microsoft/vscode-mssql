/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    SortProperties,
    type ColumnFilterMap,
    type DbCellValue,
    type IDbColumn,
} from "../../src/sharedInterfaces/queryResult";
import { FluentResultGridCommand } from "../../src/webviews/common/FluentResultGrid/types/fluentResultGridCommandIds";
import type { FluentResultGridKeyBindingMap } from "../../src/webviews/common/FluentResultGrid/types/fluentResultGridCommands";
import {
    applyFluentResultGridTransformsToSourceRows,
    normalizeFluentResultGridSelectedFilterValues,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridTransforms";
import {
    FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
    normalizeFluentResultGridFrozenColumnIndex,
    stabilizeFluentResultGridColumnInfo,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridState";
import { isFluentResultGridHostCommand } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridCommandUtils";
import { shouldRevealFluentResultGridActiveCell } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridKeyboardController";
import {
    getFluentResultGridKeyboardAction,
    type FluentResultGridKeyboardShortcutEvent,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridKeyboard";
import type { SourceRow } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridControllerTypes";
import {
    activateFluentResultGridCellWithoutChangingSelection,
    clearFluentResultGridSelection,
    convertDisplayedSelectionRowsToActual,
    getFluentResultGridClickSelection,
    getFluentResultGridDataSelectionsFromRanges,
    getFluentResultGridRangesAfterClick,
    getFluentResultGridRangesAfterDrag,
    insertFluentResultGridSelectionRange,
    setFluentResultGridSelection,
    toggleFluentResultGridSelectedCell,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridSelection";
import { SlickRange } from "@slickgrid-universal/common";
import type { SlickGrid } from "slickgrid-react";
import {
    enableFluentResultGridModifierDrag,
    isFluentResultGridAppendSelectionEvent,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridCellRangeSelector";

function cell(value: string | null): DbCellValue {
    return {
        displayValue: value ?? "",
        isNull: value === null,
    };
}

function column(columnName: string): IDbColumn {
    return {
        baseCatalogName: "database",
        baseColumnName: columnName,
        baseSchemaName: "dbo",
        baseServerName: "server",
        baseTableName: "table",
        columnName,
        dataType: "varchar",
        dataTypeName: "varchar",
        udtAssemblyQualifiedName: "",
    };
}

function keyboardEvent(
    overrides: Partial<FluentResultGridKeyboardShortcutEvent>,
): FluentResultGridKeyboardShortcutEvent {
    return {
        altKey: false,
        code: "",
        ctrlKey: false,
        key: "",
        metaKey: false,
        shiftKey: false,
        ...overrides,
    };
}

suite("Fluent Result Grid", () => {
    suite("columns", () => {
        test("retains column definitions when a result update contains the same schema", () => {
            const first = stabilizeFluentResultGridColumnInfo(undefined, [column("name")]);
            const repeatedSchema = stabilizeFluentResultGridColumnInfo(first, [column("name")]);
            const changedSchema = stabilizeFluentResultGridColumnInfo(first, [column("new_name")]);

            expect(repeatedSchema).to.equal(first);
            expect(repeatedSchema.value).to.equal(first.value);
            expect(changedSchema).to.not.equal(first);
            expect(changedSchema.value).to.not.equal(first.value);
        });
    });

    suite("transforms", () => {
        test("preserves row IDs while filtering and sorting source rows", () => {
            const rows: SourceRow[] = [
                { rowId: 3, cells: [cell("keep"), cell("2")] },
                { rowId: 1, cells: [cell("drop"), cell("1")] },
                { rowId: 2, cells: [cell("keep"), cell("1")] },
            ];
            const filters: ColumnFilterMap = {
                "0": {
                    columnDef: "0",
                    filterValues: ["keep"],
                },
            };

            const result = applyFluentResultGridTransformsToSourceRows({
                rows,
                filters,
                sort: { columnId: "1", direction: SortProperties.ASC },
            });

            expect(result.map((row) => row.rowId)).to.deep.equal([2, 3]);
        });

        test("sorts nulls, numbers, blanks, and strings with existing ordering", () => {
            const rows: SourceRow[] = [
                { rowId: 10, cells: [cell("10")] },
                { rowId: 2, cells: [cell("2")] },
                { rowId: 30, cells: [cell("abc")] },
                { rowId: 0, cells: [cell(null)] },
                { rowId: 40, cells: [cell("")] },
            ];

            const result = applyFluentResultGridTransformsToSourceRows({
                rows,
                filters: {},
                sort: { columnId: "0", direction: SortProperties.ASC },
            });

            expect(result.map((row) => row.rowId)).to.deep.equal([0, 2, 10, 40, 30]);
        });

        test("normalizes all selected filter values to no active filter", () => {
            const result = normalizeFluentResultGridSelectedFilterValues(
                ["a", "b"],
                [{ value: "a" }, { value: "b" }],
            );

            expect(result).to.deep.equal([]);
        });
    });

    suite("state helpers", () => {
        test("clamps frozen column index to the valid column range", () => {
            expect(normalizeFluentResultGridFrozenColumnIndex(undefined, 5)).to.equal(
                FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
            );
            expect(normalizeFluentResultGridFrozenColumnIndex(Number.NaN, 5)).to.equal(
                FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
            );
            expect(normalizeFluentResultGridFrozenColumnIndex(-3, 5)).to.equal(
                FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
            );
            expect(normalizeFluentResultGridFrozenColumnIndex(2.8, 5)).to.equal(2);
            expect(normalizeFluentResultGridFrozenColumnIndex(20, 5)).to.equal(4);
            expect(normalizeFluentResultGridFrozenColumnIndex(20, 0)).to.equal(
                FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
            );
        });
    });

    suite("selection", () => {
        test("recognizes Ctrl and Cmd as append-selection modifiers", () => {
            expect(isFluentResultGridAppendSelectionEvent(undefined)).to.be.false;
            expect(isFluentResultGridAppendSelectionEvent({})).to.be.false;
            expect(isFluentResultGridAppendSelectionEvent({ ctrlKey: true })).to.be.true;
            expect(isFluentResultGridAppendSelectionEvent({ metaKey: true })).to.be.true;
        });

        test("removes SlickGrid's option-merged modifier drag blockers in place", () => {
            const capturedPreventDragFromKeys = ["ctrlKey", "metaKey"];

            enableFluentResultGridModifierDrag(capturedPreventDragFromKeys);

            expect(capturedPreventDragFromKeys).to.deep.equal([]);
        });

        test("retains four consecutive Ctrl selections", () => {
            let selectedRanges: SlickRange[] = [];
            const cells = [
                { row: 1, cell: 1 },
                { row: 3, cell: 2 },
                { row: 5, cell: 3 },
                { row: 7, cell: 4 },
            ];

            for (const clickedCell of cells) {
                selectedRanges = getFluentResultGridRangesAfterClick(
                    selectedRanges,
                    clickedCell,
                    null,
                    { ctrlKey: true },
                );
            }

            expect(selectedRanges).to.deep.equal(
                cells.map((cell) => new SlickRange(cell.row, cell.cell)),
            );
        });

        test("leaves data-cell click selection to the SlickGrid selection model", () => {
            expect(getFluentResultGridClickSelection({ row: 4, cell: 2 }, 6, true)).to.equal(
                undefined,
            );

            expect(getFluentResultGridClickSelection({ row: 4, cell: 0 }, 6, true)).to.deep.equal({
                activeCell: { row: 4, cell: 1 },
                range: new SlickRange(4, 1, 4, 5),
            });
        });

        test("restores the active cell without collapsing a multi-selection", () => {
            const calls: unknown[][] = [];
            const grid = {
                setActiveCell: (...args: unknown[]) => calls.push(args),
            };

            activateFluentResultGridCellWithoutChangingSelection(
                grid as unknown as Pick<SlickGrid, "setActiveCell">,
                {
                    row: 4,
                    cell: 2,
                },
            );

            expect(calls).to.deep.equal([[4, 2, false, false, true]]);
        });

        test("updates active cell and selected ranges as one transaction", () => {
            const calls: Array<{ type: string; args: unknown[] }> = [];
            const range = new SlickRange(4, 1, 4, 5);
            const grid = {
                getSelectionModel: () => ({
                    setSelectedRanges: (...args: unknown[]) => calls.push({ type: "ranges", args }),
                }),
                setActiveCell: (...args: unknown[]) => calls.push({ type: "active", args }),
            };

            setFluentResultGridSelection(
                grid as unknown as Pick<SlickGrid, "getSelectionModel" | "setActiveCell">,
                [range],
                { row: 4, cell: 1 },
            );

            expect(calls).to.deep.equal([
                { type: "active", args: [4, 1, false, false, true] },
                { type: "ranges", args: [[range]] },
            ]);
        });

        test("keeps every disjoint range in the selection-summary payload", () => {
            expect(
                getFluentResultGridDataSelectionsFromRanges([
                    new SlickRange(1, 1),
                    new SlickRange(3, 2, 4, 3),
                    new SlickRange(7, 4),
                ]),
            ).to.deep.equal([
                { fromRow: 1, fromCell: 0, toRow: 1, toCell: 0 },
                { fromRow: 3, fromCell: 1, toRow: 4, toCell: 2 },
                { fromRow: 7, fromCell: 3, toRow: 7, toCell: 3 },
            ]);
        });

        test("maps sorted and filtered display rows to source rows for selection summaries", () => {
            const sourceRowsByDisplayRow = [8, 2, 5];

            expect(
                convertDisplayedSelectionRowsToActual(
                    [{ fromRow: 0, fromCell: 1, toRow: 2, toCell: 1 }],
                    (displayRow) => sourceRowsByDisplayRow[displayRow],
                ),
            ).to.deep.equal([
                { fromRow: 8, fromCell: 1, toRow: 8, toCell: 1 },
                { fromRow: 2, fromCell: 1, toRow: 2, toCell: 1 },
                { fromRow: 5, fromCell: 1, toRow: 5, toCell: 1 },
            ]);
        });

        test("clears selected ranges when sort or filter transforms change displayed rows", () => {
            const calls: SlickRange[][] = [];
            let activeCellWasReset = false;
            const grid = {
                getSelectionModel: () => ({
                    setSelectedRanges: (ranges: SlickRange[]) => calls.push(ranges),
                }),
                resetActiveCell: () => {
                    activeCellWasReset = true;
                },
            };

            clearFluentResultGridSelection(
                grid as unknown as Pick<SlickGrid, "getSelectionModel" | "resetActiveCell">,
            );

            expect(calls).to.deep.equal([[]]);
            expect(activeCellWasReset).to.equal(true);
        });

        test("appends Ctrl/Cmd-dragged blocks without replacing existing selections", () => {
            const existingRange = new SlickRange(1, 1, 2, 2);
            const draggedRange = new SlickRange(4, 3, 5, 4);

            expect(
                getFluentResultGridRangesAfterDrag([existingRange], draggedRange, true),
            ).to.deep.equal([existingRange, draggedRange]);
            expect(
                getFluentResultGridRangesAfterDrag([existingRange], draggedRange, false),
            ).to.deep.equal([draggedRange]);
        });

        test("does not duplicate an identical appended block", () => {
            const existingRange = new SlickRange(1, 1, 2, 2);

            expect(
                getFluentResultGridRangesAfterDrag(
                    [existingRange],
                    new SlickRange(1, 1, 2, 2),
                    true,
                ),
            ).to.deep.equal([existingRange]);
        });

        test("merges adjacent appended blocks like the Production Grid", () => {
            expect(
                insertFluentResultGridSelectionRange(
                    [new SlickRange(1, 1, 2, 2)],
                    new SlickRange(1, 3, 2, 4),
                ),
            ).to.deep.equal([new SlickRange(1, 1, 2, 4)]);
            expect(
                insertFluentResultGridSelectionRange(
                    [new SlickRange(1, 1, 2, 2)],
                    new SlickRange(3, 1, 4, 2),
                ),
            ).to.deep.equal([new SlickRange(1, 1, 4, 2)]);
        });

        test("adds an unselected cell and removes a selected cell from a block", () => {
            const existingRange = new SlickRange(1, 1, 3, 3);

            expect(toggleFluentResultGridSelectedCell([existingRange], 5, 5)).to.deep.equal([
                existingRange,
                new SlickRange(5, 5),
            ]);
            expect(toggleFluentResultGridSelectedCell([existingRange], 2, 2)).to.deep.equal([
                new SlickRange(1, 1, 1, 3),
                new SlickRange(3, 1, 3, 3),
                new SlickRange(2, 1, 2, 1),
                new SlickRange(2, 3, 2, 3),
            ]);
        });
    });

    suite("commands", () => {
        test("keeps local grid commands out of host command forwarding", () => {
            expect(isFluentResultGridHostCommand(FluentResultGridCommand.SelectAll)).to.equal(
                false,
            );
            expect(isFluentResultGridHostCommand(FluentResultGridCommand.ToggleSort)).to.equal(
                false,
            );
            expect(isFluentResultGridHostCommand(FluentResultGridCommand.CopySelection)).to.equal(
                true,
            );
            expect(isFluentResultGridHostCommand("custom.export")).to.equal(true);
        });
    });

    suite("keyboard", () => {
        test("maps configured shortcuts to command actions", () => {
            const keyBindings: FluentResultGridKeyBindingMap = {
                [FluentResultGridCommand.CopySelection]: {
                    keyCombination: { code: "KeyC", ctrlKey: true },
                },
            };

            const action = getFluentResultGridKeyboardAction(
                keyboardEvent({ code: "KeyC", ctrlKey: true }),
                keyBindings,
            );

            expect(action).to.deep.equal({
                kind: "command",
                commandId: FluentResultGridCommand.CopySelection,
            });
        });

        test("maps fallback select-all and shift-arrow shortcuts", () => {
            expect(
                getFluentResultGridKeyboardAction(
                    keyboardEvent({ code: "KeyA", ctrlKey: true }),
                    {},
                ),
            ).to.deep.equal({
                kind: "command",
                commandId: FluentResultGridCommand.SelectAll,
            });

            expect(
                getFluentResultGridKeyboardAction(
                    keyboardEvent({ code: "ArrowRight", shiftKey: true }),
                    {},
                ),
            ).to.deep.equal({
                kind: "command",
                commandId: FluentResultGridCommand.ExpandSelectionRight,
            });
        });

        test("maps column-menu and focus traversal actions", () => {
            expect(
                getFluentResultGridKeyboardAction(keyboardEvent({ code: "ContextMenu" }), {}),
            ).to.deep.equal({ kind: "openColumnMenu" });

            expect(
                getFluentResultGridKeyboardAction(keyboardEvent({ code: "Tab" }), {}),
            ).to.deep.equal({ kind: "moveFocus", forward: true });

            expect(
                getFluentResultGridKeyboardAction(
                    keyboardEvent({ code: "Tab", shiftKey: true }),
                    {},
                ),
            ).to.deep.equal({ kind: "moveFocus", forward: false });
        });

        test("only keyboard-visible container focus reveals the active cell", () => {
            expect(shouldRevealFluentResultGridActiveCell(true, true)).to.equal(true);
            expect(shouldRevealFluentResultGridActiveCell(true, false)).to.equal(false);
            expect(shouldRevealFluentResultGridActiveCell(false, true)).to.equal(false);
        });
    });
});
