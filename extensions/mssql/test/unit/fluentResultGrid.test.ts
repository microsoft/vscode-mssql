/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
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
    getFluentResultGridRowsForFilterMenu,
    normalizeFluentResultGridSelectedFilterValues,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridTransforms";
import {
    FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
    areFluentResultGridColumnLayoutsEqual,
    getFluentResultGridCurrentViewState,
    getFluentResultGridInitialFrozenColumnIndex,
    normalizeFluentResultGridFrozenColumnIndex,
    restoreFluentResultGridColumnWidths,
    stabilizeFluentResultGridColumnInfo,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridState";
import { isFluentResultGridHostCommand } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridCommandUtils";
import { shouldRevealFluentResultGridActiveCell } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridKeyboardController";
import {
    getFluentResultGridKeyboardAction,
    fluentResultGridEventMatchesShortcut,
    isFluentResultGridMetaOrCtrlKeyPressed,
    type FluentResultGridKeyboardShortcutEvent,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridKeyboard";
import type { SourceRow } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridControllerTypes";
import {
    activateFluentResultGridCellWithoutChangingSelection,
    clearFluentResultGridSelection,
    convertDisplayedSelectionRowsToActual,
    getDisplayedFluentResultGridSelectionForCopy,
    getFirstVisibleCellInFluentResultGridRange,
    getFluentResultGridDataColumnIndex,
    getFluentResultGridKeyboardExpansion,
    getFluentResultGridRangesAfterHeaderClick,
    getFluentResultGridRangesForVisibleColumns,
    getFluentResultGridRowEdgeCell,
    getFluentResultGridRowNumberClickSelection,
    getFluentResultGridDataSelectionsFromRanges,
    getFluentResultGridRangesAfterClick,
    getFluentResultGridRangesAfterDrag,
    getFluentResultGridSelectionSummaryPayload,
    getFluentResultGridSelectionForSave,
    getFluentResultGridSlickRangesFromDataSelections,
    handleFluentResultGridRowDoubleClick,
    insertFluentResultGridSelectionRange,
    setFluentResultGridSelection,
    toggleFluentResultGridSelectedCell,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridSelection";
import { SlickEvent, SlickEventData, SlickRange } from "@slickgrid-universal/common";
import type { SlickGrid } from "slickgrid-react";
import {
    enableFluentResultGridModifierDrag,
    isFluentResultGridAppendSelectionEvent,
    isFluentResultGridSecondaryButtonEvent,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridCellRangeSelector";
import {
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridConstants";
import {
    createFluentResultGridRowNumberColumn,
    getFluentResultGridRowNumberContent,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridRowNumber";
import {
    autoSizeFluentResultGridColumnByContent,
    getFluentResultGridColumnResizeDoubleClickTarget,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridColumnAutosize";
import { isFluentResultGridResizeHandleEvent } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridHeaderController";
import { FluentResultGridSelectionModel } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridSelectionModel";
import { dispatchFluentResultGridSelectionChange } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridSlickLifecycle";
import { createFluentResultGridDataView } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridDataView";

chai.use(sinonChai);
const { expect } = chai;

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

function selectionColumns(
    sourceColumnIndexes: readonly number[],
    options?: { hiddenSourceColumns?: readonly number[]; showRowNumberColumn?: boolean },
) {
    const hiddenSourceColumns = new Set(options?.hiddenSourceColumns ?? []);
    const dataColumns = sourceColumnIndexes.map((sourceColumnIndex) => ({
        id: sourceColumnIndex.toString(),
        field: sourceColumnIndex.toString(),
        hidden: hiddenSourceColumns.has(sourceColumnIndex),
    }));

    return options?.showRowNumberColumn === false
        ? dataColumns
        : [
              {
                  id: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
                  field: "_rowNumber",
                  hidden: false,
              },
              ...dataColumns,
          ];
}

class TestableFluentResultGridSelectionModel extends FluentResultGridSelectionModel {
    public setGridForTest(grid: SlickGrid): void {
        this._grid = grid;
    }

    public handleClickForTest(eventData: SlickEventData): boolean | void {
        return this.handleClick(eventData);
    }
}

suite("Fluent Result Grid", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("columns", () => {
        test("allows the row number column to be widened", () => {
            const rowNumberColumn = createFluentResultGridRowNumberColumn();

            expect(rowNumberColumn, "row-number column").to.exist;
            expect(rowNumberColumn).to.include({
                width: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
                minWidth: FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_WIDTH,
                resizable: true,
            });
            expect(rowNumberColumn).to.not.have.property("maxWidth");
        });

        test("shows the full row number in a tooltip", () => {
            const content = getFluentResultGridRowNumberContent("10000");

            expect(content.textContent).to.equal("10000");
            expect(content.title).to.equal("10000");
        });

        test("does not turn a resize-handle click into a header selection", () => {
            const resizeHandle = {};
            const closest = sandbox.stub();
            closest.withArgs(".slick-resizable-handle").returns(resizeHandle);

            expect(
                isFluentResultGridResizeHandleEvent({
                    target: { closest },
                } as unknown as MouseEvent),
            ).to.equal(true);
            expect(
                isFluentResultGridResizeHandleEvent({
                    target: { closest: sandbox.stub().returns(null) },
                } as unknown as MouseEvent),
            ).to.equal(false);
            expect(isFluentResultGridResizeHandleEvent(undefined)).to.equal(false);
        });

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

    suite("data view", () => {
        test("reuses loaded or in-flight windows until a reload is explicitly requested", async () => {
            const getRows = sandbox
                .stub()
                .callsFake(async (offset: number, count: number) =>
                    Array.from({ length: count }, (_value, index) => [
                        cell((offset + index).toString()),
                    ]),
                );
            const dataView = createFluentResultGridDataView({
                dataSource: {
                    kind: "windowed",
                    rowCount: 100,
                    getRows,
                },
                columnCount: 1,
                windowSize: 50,
            });

            dataView.getItem(0);
            expect(getRows).to.have.callCount(2);

            dataView.setLength(101, false);
            dataView.getItem(0);
            expect(getRows).to.have.callCount(2);

            await Promise.resolve();
            await Promise.resolve();
            dataView.setLength(102, false);
            dataView.getItem(0);
            expect(getRows).to.have.callCount(2);

            dataView.refresh(0);
            expect(getRows).to.have.callCount(4);
            dataView.dispose();
        });

        const incompleteResponses: Array<{
            name: string;
            response: DbCellValue[][] | Error | undefined;
        }> = [
            { name: "an empty response", response: [] },
            { name: "a partial response", response: [[cell("partial")]] },
            { name: "a malformed response", response: undefined },
            { name: "a rejected request", response: new Error("load failed") },
        ];

        for (const { name, response } of incompleteResponses) {
            test(`retries an unchanged window through getItem after ${name}`, async () => {
                let firstWindowRequestCount = 0;
                const getRows = sandbox.stub().callsFake(async (offset: number, count: number) => {
                    if (offset === 0 && firstWindowRequestCount++ === 0) {
                        if (response instanceof Error) {
                            throw response;
                        }

                        return response as DbCellValue[][];
                    }

                    return Array.from({ length: count }, (_value, index) => [
                        cell((offset + index).toString()),
                    ]);
                });
                const dataView = createFluentResultGridDataView({
                    dataSource: {
                        kind: "windowed",
                        rowCount: 100,
                        getRows,
                    },
                    columnCount: 1,
                    windowSize: 50,
                });

                dataView.getItem(0);
                expect(getRows).to.have.callCount(2);

                await Promise.resolve();
                await Promise.resolve();
                dataView.getItem(0);
                expect(getRows).to.have.callCount(3);

                await Promise.resolve();
                await Promise.resolve();
                const loadedRow = dataView.getItem(0);
                expect(getRows).to.have.callCount(3);
                expect(loadedRow["0"]).to.include({ displayValue: "0" });
                dataView.dispose();
            });
        }
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

        test("narrows filter-menu rows by other filters but ignores the menu's own filter", () => {
            const rows: SourceRow[] = [
                { rowId: 0, cells: [cell("red"), cell("north")] },
                { rowId: 1, cells: [cell("blue"), cell("north")] },
                { rowId: 2, cells: [cell("red"), cell("south")] },
                { rowId: 3, cells: [cell("blue"), cell("south")] },
            ];
            const filters: ColumnFilterMap = {
                "0": { columnDef: "0", filterValues: ["red"] },
                "1": { columnDef: "1", filterValues: ["north"] },
            };

            expect(
                getFluentResultGridRowsForFilterMenu({ rows, filters, columnId: "0" }).map(
                    (row) => row.rowId,
                ),
                "color menu keeps both colors that survive the region filter",
            ).to.deep.equal([0, 1]);
            expect(
                getFluentResultGridRowsForFilterMenu({ rows, filters, columnId: "1" }).map(
                    (row) => row.rowId,
                ),
                "region menu keeps both regions that survive the color filter",
            ).to.deep.equal([0, 2]);
        });
    });

    suite("column autosize", () => {
        test("resolves the clicked column and grid from SlickGrid's resize event", () => {
            const grid = {} as SlickGrid;

            expect(
                getFluentResultGridColumnResizeDoubleClickTarget({
                    args: { grid, triggeredByColumn: "0" },
                }),
            ).to.deep.equal({ grid, columnId: "0" });
            expect(
                getFluentResultGridColumnResizeDoubleClickTarget({
                    args: { triggeredByColumn: "0" },
                }),
            ).to.be.undefined;
        });

        test("measures fetched rows, preserves concurrent column changes, and publishes growth", async () => {
            let currentColumns = [
                { id: "rowNumbers", field: "rowNumbers", width: 36 },
                { id: "target", field: "0", name: "Target", width: 70 },
                { id: "other", field: "1", name: "Other", width: 120 },
            ];
            const onColumnsResized = new SlickEvent();
            const notify = sandbox.stub(onColumnsResized, "notify");
            const setColumns = sandbox.stub().callsFake((columns) => {
                currentColumns = columns;
            });
            const invalidate = sandbox.stub();
            const grid = {
                getColumns: sandbox.stub().callsFake(() => currentColumns),
                setColumns,
                invalidate,
                onColumnsResized,
            } as unknown as SlickGrid;
            let resolveRows!: (rows: Array<Record<string, string>>) => void;
            const getSampleRows = sandbox.stub().returns(
                new Promise<Array<Record<string, string>>>((resolve) => {
                    resolveRows = resolve;
                }),
            );

            const resize = autoSizeFluentResultGridColumnByContent({
                grid,
                columnId: "target",
                getSampleRows,
                getCellText: (row, columnDataIndex) => row[columnDataIndex.toString()],
                measureText: (text) => text.length * 10,
            });
            currentColumns = [
                { id: "rowNumbers", field: "rowNumbers", width: 36 },
                { id: "other", field: "1", name: "Other", width: 222 },
                { id: "target", field: "0", name: "Target", width: 80 },
            ];
            resolveRows([{ "0": "abcdefghij" }]);
            await resize;

            expect(getSampleRows).to.have.been.called;
            expect(setColumns).to.have.been.called;
            expect(currentColumns).to.deep.equal([
                { id: "rowNumbers", field: "rowNumbers", width: 36 },
                { id: "other", field: "1", name: "Other", width: 222 },
                { id: "target", field: "0", name: "Target", width: 121 },
            ]);
            expect(invalidate).to.have.been.called;
            expect(notify).to.have.been.calledWithMatch({
                grid,
                triggeredByColumn: "target",
            });
        });

        test("shrinks a widened column to its fitted content width", async () => {
            let columns = [
                { id: "rowNumbers", field: "rowNumbers", width: 36 },
                { id: "target", field: "0", name: "Target", width: 300 },
            ];
            const onColumnsResized = new SlickEvent();
            const notify = sandbox.stub(onColumnsResized, "notify");
            const setColumns = sandbox.stub().callsFake((resizedColumns) => {
                columns = resizedColumns;
            });
            const invalidate = sandbox.stub();
            const grid = {
                getColumns: sandbox.stub().callsFake(() => columns),
                setColumns,
                invalidate,
                onColumnsResized,
            } as unknown as SlickGrid;

            await autoSizeFluentResultGridColumnByContent({
                grid,
                columnId: "target",
                getSampleRows: sandbox.stub().resolves([{ "0": "short" }]),
                getCellText: (row, columnDataIndex) => row[columnDataIndex.toString()],
                measureText: (text) => text.length * 10,
            });

            expect(setColumns).to.have.been.calledOnce;
            expect(columns[1].width).to.equal(116);
            expect(invalidate).to.have.been.calledOnce;
            expect(notify).to.have.been.calledWithMatch({
                grid,
                triggeredByColumn: "target",
            });
        });
    });

    suite("state helpers", () => {
        test("compares the column layout fields that require a SlickGrid reset", () => {
            const columns = [
                { id: "rowNumbers", field: "rowNumbers", width: 36 },
                { id: "0", field: "0", width: 120, hidden: false },
            ];

            expect(
                areFluentResultGridColumnLayoutsEqual(columns, [
                    { ...columns[0] },
                    { ...columns[1], hidden: undefined },
                ]),
            ).to.equal(true);
            expect(
                areFluentResultGridColumnLayoutsEqual(columns, [
                    columns[0],
                    { ...columns[1], width: 160 },
                ]),
            ).to.equal(false);
            expect(
                areFluentResultGridColumnLayoutsEqual(columns, [columns[1], columns[0]]),
            ).to.equal(false);
        });

        test("persists and restores the row number column width", () => {
            const currentColumns = [
                { ...createFluentResultGridRowNumberColumn(), width: 80 },
                { id: "0", field: "0", width: 160 },
            ];
            const grid = {
                getColumns: () => currentColumns,
                getOptions: () => ({}),
                getSelectionModel: () => undefined,
            } as unknown as SlickGrid;

            const viewState = getFluentResultGridCurrentViewState({
                grid,
                frozenColumnIndex: FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
            });
            const restoredColumns = restoreFluentResultGridColumnWidths(
                [createFluentResultGridRowNumberColumn(), { id: "0", field: "0", width: 120 }],
                {
                    columnWidths: [160],
                    rowNumberColumnWidth: viewState.rowNumberColumnWidth,
                },
            );

            expect(viewState.rowNumberColumnWidth).to.equal(80);
            expect(restoredColumns[0].width).to.equal(80);
            expect(restoredColumns[1].width).to.equal(160);
        });

        test("persists selection columns by source identity after a reorder", () => {
            const columns = selectionColumns([2, 0, 1]);
            const grid = {
                getColumns: sandbox.stub().returns(columns),
                getOptions: sandbox.stub().returns({}),
                getSelectionModel: sandbox.stub().returns({
                    getSelectedRanges: () => [new SlickRange(1, 1, 2, 2)],
                }),
            } as unknown as SlickGrid;

            const viewState = getFluentResultGridCurrentViewState({
                grid,
                frozenColumnIndex: FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
            });

            expect(viewState.selection).to.deep.equal([
                { fromRow: 1, fromCell: 2, toRow: 2, toCell: 2 },
                { fromRow: 1, fromCell: 0, toRow: 2, toCell: 0 },
            ]);
            expect(
                getFluentResultGridSlickRangesFromDataSelections(viewState.selection, 3, columns),
            ).to.deep.equal([new SlickRange(1, 1, 2, 2)]);
        });

        test("uses the optional freeze-first-column default only when no saved state exists", () => {
            expect(getFluentResultGridInitialFrozenColumnIndex(undefined, false)).to.equal(0);
            expect(getFluentResultGridInitialFrozenColumnIndex(undefined, true)).to.equal(1);
            expect(getFluentResultGridInitialFrozenColumnIndex(0, true)).to.equal(0);
            expect(getFluentResultGridInitialFrozenColumnIndex(3, false)).to.equal(3);
        });

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

        test("treats non-primary mouse buttons as secondary drag gestures", () => {
            // Right-click must not start a range selection: the drag service binds mousedown for
            // every button, so an unguarded right-drag replaces a Ctrl-built selection.
            expect(isFluentResultGridSecondaryButtonEvent({ button: 2 })).to.be.true;
            expect(isFluentResultGridSecondaryButtonEvent({ button: 1 })).to.be.true;
            expect(isFluentResultGridSecondaryButtonEvent({ nativeEvent: { button: 2 } })).to.be
                .true;

            expect(isFluentResultGridSecondaryButtonEvent({ button: 0 })).to.be.false;
            expect(isFluentResultGridSecondaryButtonEvent({ nativeEvent: { button: 0 } })).to.be
                .false;
            // Touch and keyboard gestures report no button at all.
            expect(isFluentResultGridSecondaryButtonEvent({})).to.be.false;
            expect(isFluentResultGridSecondaryButtonEvent(undefined)).to.be.false;
            expect(isFluentResultGridSecondaryButtonEvent({ nativeEvent: null })).to.be.false;
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

        test("selection model owns Ctrl+click as one active-cell and range transaction", () => {
            let activeCell = { row: 1, cell: 1 };
            const setActiveCell = sandbox.stub().callsFake((row: number, cell: number) => {
                activeCell = { row, cell };
            });
            const grid = {
                canCellBeActive: sandbox.stub().returns(true),
                canCellBeSelected: sandbox.stub().returns(true),
                getActiveCell: sandbox.stub().callsFake(() => activeCell),
                getCellFromEvent: sandbox.stub().returns({ row: 4, cell: 2 }),
                getColumns: sandbox.stub().returns(selectionColumns([0, 1, 2])),
                getOptions: sandbox.stub().returns({ multiSelect: true }),
                setActiveCell,
            } as unknown as SlickGrid;
            const model = new TestableFluentResultGridSelectionModel({ selectionType: "cell" });
            model.setGridForTest(grid);
            model.setSelectedRanges([new SlickRange(1, 1)]);
            const nativeEvent = {
                ctrlKey: true,
                stopImmediatePropagation: sandbox.stub(),
            } as unknown as Event;

            expect(model.handleClickForTest(new SlickEventData(nativeEvent))).to.equal(true);
            expect(model.getSelectedRanges()).to.deep.equal([
                new SlickRange(1, 1),
                new SlickRange(4, 2),
            ]);
            expect(setActiveCell).to.have.been.calledWith(4, 2, false, false, true);
        });

        test("selection model resolves a hidden-column row-number click before activation checks", () => {
            const setActiveCell = sandbox.stub();
            const canCellBeActive = sandbox.stub().returns(false);
            const grid = {
                canCellBeActive,
                canCellBeSelected: sandbox.stub().returns(true),
                getActiveCell: sandbox.stub().returns({ row: 2, cell: 2 }),
                getCellFromEvent: sandbox.stub().returns({ row: 5, cell: 0 }),
                getColumns: sandbox
                    .stub()
                    .returns(selectionColumns([0, 1], { hiddenSourceColumns: [0] })),
                getOptions: sandbox.stub().returns({ multiSelect: true }),
                setActiveCell,
            } as unknown as SlickGrid;
            const model = new TestableFluentResultGridSelectionModel({ selectionType: "cell" });
            model.setGridForTest(grid);
            const nativeEvent = {
                stopImmediatePropagation: sandbox.stub(),
            } as unknown as Event;

            expect(model.handleClickForTest(new SlickEventData(nativeEvent))).to.equal(true);
            expect(model.getSelectedRanges()).to.deep.equal([new SlickRange(5, 2)]);
            expect(setActiveCell).to.have.been.calledWith(5, 2, false, false, true);
            expect(canCellBeActive).not.to.have.been.called;
        });

        test("leaves data-cell click selection to the SlickGrid selection model", () => {
            expect(
                getFluentResultGridRowNumberClickSelection(
                    [],
                    { row: 4, cell: 2 },
                    null,
                    {},
                    6,
                    true,
                ),
            ).to.equal(undefined);
        });

        test("selects the whole row for a plain row-number click", () => {
            expect(
                getFluentResultGridRowNumberClickSelection(
                    [],
                    { row: 4, cell: 0 },
                    null,
                    {},
                    6,
                    true,
                ),
            ).to.deep.equal({
                activeCell: { row: 4, cell: 1 },
                ranges: [new SlickRange(4, 1, 4, 5)],
            });
        });

        test("Ctrl+click on a row number adds the row, then carves it back out", () => {
            const added = getFluentResultGridRowNumberClickSelection(
                [new SlickRange(1, 1, 1, 5)],
                { row: 4, cell: 0 },
                null,
                { ctrlKey: true },
                6,
                true,
            );
            expect(added?.ranges).to.deep.equal([
                new SlickRange(1, 1, 1, 5),
                new SlickRange(4, 1, 4, 5),
            ]);

            const removed = getFluentResultGridRowNumberClickSelection(
                [new SlickRange(0, 1, 4, 5)],
                { row: 2, cell: 0 },
                null,
                { metaKey: true },
                6,
                true,
            );
            expect(removed?.ranges).to.deep.equal([
                new SlickRange(0, 1, 1, 5),
                new SlickRange(3, 1, 4, 5),
            ]);
        });

        test("Ctrl+click completes a partially selected row before toggling it off", () => {
            const completed = getFluentResultGridRowNumberClickSelection(
                [new SlickRange(2, 3), new SlickRange(7, 2)],
                { row: 2, cell: 0 },
                null,
                { ctrlKey: true },
                6,
                true,
            );
            expect(completed?.ranges).to.deep.equal([
                new SlickRange(7, 2),
                new SlickRange(2, 1, 2, 5),
            ]);

            const removed = getFluentResultGridRowNumberClickSelection(
                completed?.ranges ?? [],
                { row: 2, cell: 0 },
                null,
                { ctrlKey: true },
                6,
                true,
            );
            expect(removed?.ranges).to.deep.equal([new SlickRange(7, 2)]);
        });

        test("Shift+click on a row number extends from the active row", () => {
            expect(
                getFluentResultGridRowNumberClickSelection(
                    [],
                    { row: 6, cell: 0 },
                    { row: 2, cell: 3 },
                    { shiftKey: true },
                    6,
                    true,
                )?.ranges,
            ).to.deep.equal([new SlickRange(2, 1, 6, 5)]);
        });

        test("Shift takes precedence over Ctrl on row-number clicks", () => {
            expect(
                getFluentResultGridRowNumberClickSelection(
                    [new SlickRange(8, 1, 8, 5)],
                    { row: 6, cell: 0 },
                    { row: 2, cell: 3 },
                    { ctrlKey: true, shiftKey: true },
                    6,
                    true,
                )?.ranges,
            ).to.deep.equal([new SlickRange(2, 1, 6, 5)]);
        });

        test("focuses the first visible data cell after a row-number click", () => {
            expect(
                getFluentResultGridRowNumberClickSelection(
                    [],
                    { row: 4, cell: 0 },
                    null,
                    {},
                    6,
                    true,
                    [{}, { hidden: true }, { hidden: true }, {}, {}, {}],
                )?.activeCell,
            ).to.deep.equal({ row: 4, cell: 3 });
        });

        test("row-number clicks select only contiguous runs of visible cells", () => {
            expect(
                getFluentResultGridRowNumberClickSelection(
                    [],
                    { row: 4, cell: 0 },
                    null,
                    {},
                    7,
                    true,
                    [{}, {}, { hidden: true }, {}, {}, { hidden: true }, {}],
                ),
            ).to.deep.equal({
                activeCell: { row: 4, cell: 1 },
                ranges: [
                    new SlickRange(4, 1, 4, 1),
                    new SlickRange(4, 3, 4, 4),
                    new SlickRange(4, 6, 4, 6),
                ],
            });
        });

        test("builds multi-row ranges containing only visible columns", () => {
            expect(
                getFluentResultGridRangesForVisibleColumns(
                    [{}, { hidden: true }, {}, {}, { hidden: true }, {}],
                    2,
                    6,
                ),
            ).to.deep.equal([new SlickRange(2, 2, 6, 3), new SlickRange(2, 5, 6, 5)]);
        });

        test("does not create a rejected row range when every data column is hidden", () => {
            expect(
                getFluentResultGridRowNumberClickSelection(
                    [],
                    { row: 4, cell: 0 },
                    null,
                    {},
                    4,
                    true,
                    [{}, { hidden: true }, { hidden: true }, { hidden: true }],
                ),
            ).to.equal(undefined);
        });

        test("double-click selects all and only visible cells in the clicked row", () => {
            const setSelectedRanges = sandbox.stub();
            const setActiveCell = sandbox.stub();
            const grid = {
                getColumns: sandbox
                    .stub()
                    .returns([{}, { hidden: true }, {}, {}, { hidden: true }, {}]),
                getSelectionModel: sandbox.stub().returns({ setSelectedRanges }),
                setActiveCell,
            } as unknown as SlickGrid;

            handleFluentResultGridRowDoubleClick(
                { detail: { args: { grid, row: 7 } } } as CustomEvent,
                true,
            );

            expect(setActiveCell).to.have.been.calledWith(7, 2, false, false, true);
            expect(setSelectedRanges).to.have.been.calledWith([
                new SlickRange(7, 2, 7, 3),
                new SlickRange(7, 5, 7, 5),
            ]);
        });

        test("Ctrl+click on a column header toggles the whole column", () => {
            expect(
                getFluentResultGridRangesAfterHeaderClick([], 3, null, { ctrlKey: true }, 10),
            ).to.deep.equal([new SlickRange(0, 3, 9, 3)]);

            expect(
                getFluentResultGridRangesAfterHeaderClick(
                    [new SlickRange(0, 2, 9, 4)],
                    3,
                    null,
                    { ctrlKey: true },
                    10,
                ),
            ).to.deep.equal([new SlickRange(0, 2, 9, 2), new SlickRange(0, 4, 9, 4)]);
        });

        test("Shift+click on a column header extends from the active cell's column", () => {
            expect(
                getFluentResultGridRangesAfterHeaderClick(
                    [],
                    5,
                    { row: 3, cell: 2 },
                    { shiftKey: true },
                    10,
                ),
            ).to.deep.equal([new SlickRange(0, 2, 9, 5)]);
        });

        test("Shift takes precedence over Ctrl on column-header clicks", () => {
            expect(
                getFluentResultGridRangesAfterHeaderClick(
                    [new SlickRange(0, 1, 9, 1)],
                    5,
                    { row: 3, cell: 2 },
                    { ctrlKey: true, shiftKey: true },
                    10,
                ),
            ).to.deep.equal([new SlickRange(0, 2, 9, 5)]);
        });

        test("Shift takes precedence over Ctrl on data-cell clicks", () => {
            expect(
                getFluentResultGridRangesAfterClick(
                    [new SlickRange(8, 1)],
                    { row: 6, cell: 5 },
                    { row: 2, cell: 2 },
                    { ctrlKey: true, shiftKey: true },
                ),
            ).to.deep.equal([new SlickRange(2, 2, 6, 5)]);
        });

        test("a plain column-header click replaces the selection", () => {
            expect(
                getFluentResultGridRangesAfterHeaderClick(
                    [new SlickRange(0, 1, 9, 1)],
                    4,
                    { row: 3, cell: 2 },
                    {},
                    10,
                ),
            ).to.deep.equal([new SlickRange(0, 4, 9, 4)]);
        });

        test("column-header Shift selection can anchor at cell zero without row numbers", () => {
            expect(
                getFluentResultGridRangesAfterHeaderClick(
                    [],
                    2,
                    { row: 3, cell: 0 },
                    { shiftKey: true },
                    5,
                    0,
                ),
            ).to.deep.equal([new SlickRange(0, 0, 4, 2)]);
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
                getFluentResultGridDataSelectionsFromRanges(
                    [new SlickRange(1, 1), new SlickRange(3, 2, 4, 3), new SlickRange(7, 4)],
                    selectionColumns([0, 1, 2, 3]),
                ),
            ).to.deep.equal([
                { fromRow: 1, fromCell: 0, toRow: 1, toCell: 0 },
                { fromRow: 3, fromCell: 1, toRow: 4, toCell: 2 },
                { fromRow: 7, fromCell: 3, toRow: 7, toCell: 3 },
            ]);
        });

        test("maps visual ranges through reordered columns and excludes hidden columns", () => {
            const columns = selectionColumns([2, 0, 1, 3], { hiddenSourceColumns: [1] });

            expect(
                getFluentResultGridDataSelectionsFromRanges([new SlickRange(4, 1, 5, 4)], columns),
            ).to.deep.equal([
                { fromRow: 4, fromCell: 2, toRow: 5, toCell: 2 },
                { fromRow: 4, fromCell: 0, toRow: 5, toCell: 0 },
                { fromRow: 4, fromCell: 3, toRow: 5, toCell: 3 },
            ]);
        });

        test("maps ranges correctly when the row-number column is disabled", () => {
            const columns = selectionColumns([0, 1, 2], { showRowNumberColumn: false });

            expect(
                getFluentResultGridDataSelectionsFromRanges([new SlickRange(2, 0, 3, 2)], columns),
            ).to.deep.equal([{ fromRow: 2, fromCell: 0, toRow: 3, toCell: 2 }]);
            expect(getFluentResultGridDataColumnIndex(columns[0])).to.equal(0);
        });

        test("restores source-column selections into reordered visible column runs", () => {
            const columns = selectionColumns([2, 0, 1, 3], { hiddenSourceColumns: [1] });
            const restored = getFluentResultGridSlickRangesFromDataSelections(
                [{ fromRow: -5, fromCell: 0, toRow: 99, toCell: 2 }],
                6,
                columns,
            );

            expect(restored).to.deep.equal([new SlickRange(0, 1, 5, 2)]);
            expect(getFluentResultGridDataSelectionsFromRanges(restored, columns)).to.deep.equal([
                { fromRow: 0, fromCell: 2, toRow: 5, toCell: 2 },
                { fromRow: 0, fromCell: 0, toRow: 5, toCell: 0 },
            ]);
        });

        test("normalizes reversed saved rows and ignores unavailable source columns", () => {
            const columns = selectionColumns([0, 2], { showRowNumberColumn: false });

            expect(
                getFluentResultGridSlickRangesFromDataSelections(
                    [
                        { fromRow: 4, fromCell: 2, toRow: 1, toCell: 2 },
                        { fromRow: 0, fromCell: 99, toRow: 3, toCell: 100 },
                    ],
                    5,
                    columns,
                ),
            ).to.deep.equal([new SlickRange(1, 1, 4, 1)]);
        });

        test("finds a visible active cell with or without row numbers", () => {
            const grid = {
                getColumns: sandbox
                    .stub()
                    .returns(selectionColumns([0, 1, 2], { hiddenSourceColumns: [0] })),
            } as unknown as SlickGrid;

            expect(
                getFirstVisibleCellInFluentResultGridRange(grid, new SlickRange(3, 1, 3, 1)),
            ).to.deep.equal({ row: 3, cell: 2 });

            grid.getColumns = sandbox
                .stub()
                .returns(selectionColumns([0, 1], { showRowNumberColumn: false }));
            expect(
                getFirstVisibleCellInFluentResultGridRange(grid, new SlickRange(1, 0, 1, 1)),
            ).to.deep.equal({ row: 1, cell: 0 });
        });

        test("moves row edges and Shift+Arrow expansion only through visible data cells", () => {
            const columns = selectionColumns([0, 1, 2, 3], { hiddenSourceColumns: [1, 3] });

            expect(getFluentResultGridRowEdgeCell(columns, false)).to.equal(1);
            expect(getFluentResultGridRowEdgeCell(columns, true)).to.equal(3);
            expect(
                getFluentResultGridKeyboardExpansion({
                    selectedRanges: [new SlickRange(2, 1)],
                    activeCell: { row: 2, cell: 1 },
                    keyCode: "ArrowRight",
                    rowCount: 5,
                    columns,
                }),
            ).to.deep.equal({
                ranges: [new SlickRange(2, 1, 2, 3)],
                target: { row: 2, cell: 3 },
            });
        });

        test("Shift+Arrow expansion shrinks around its anchor and clamps row boundaries", () => {
            const columns = selectionColumns([0, 1, 2]);
            const priorRange = new SlickRange(0, 1);

            expect(
                getFluentResultGridKeyboardExpansion({
                    selectedRanges: [priorRange, new SlickRange(1, 1, 1, 3)],
                    activeCell: { row: 1, cell: 3 },
                    keyCode: "ArrowRight",
                    rowCount: 4,
                    columns,
                }),
            ).to.deep.equal({
                ranges: [priorRange, new SlickRange(1, 2, 1, 3)],
                target: { row: 1, cell: 2 },
            });

            expect(
                getFluentResultGridKeyboardExpansion({
                    selectedRanges: [new SlickRange(0, 1)],
                    activeCell: { row: 0, cell: 1 },
                    keyCode: "ArrowUp",
                    rowCount: 4,
                    columns,
                })?.target,
            ).to.deep.equal({ row: 0, cell: 1 });
        });

        test("supports keyboard expansion from cell zero without row numbers", () => {
            const columns = selectionColumns([0, 1, 2], { showRowNumberColumn: false });

            expect(
                getFluentResultGridKeyboardExpansion({
                    selectedRanges: [],
                    activeCell: { row: 0, cell: 0 },
                    keyCode: "ArrowRight",
                    rowCount: 2,
                    columns,
                }),
            ).to.deep.equal({
                ranges: [new SlickRange(0, 0, 0, 1)],
                target: { row: 0, cell: 1 },
            });
        });

        test("orders copied ranges by their displayed rows", () => {
            const grid = {
                getColumns: () => selectionColumns([0, 1, 2]),
                getSelectionModel: () => ({
                    getSelectedRanges: () => [
                        new SlickRange(3, 1, 3, 3),
                        new SlickRange(0, 1, 0, 2),
                        new SlickRange(2, 2, 2, 2),
                    ],
                }),
            };

            expect(
                getDisplayedFluentResultGridSelectionForCopy(grid as unknown as SlickGrid, 4),
            ).to.deep.equal([
                { fromRow: 0, fromCell: 0, toRow: 0, toCell: 1 },
                { fromRow: 2, fromCell: 1, toRow: 2, toCell: 1 },
                { fromRow: 3, fromCell: 0, toRow: 3, toCell: 2 },
            ]);
        });

        test("copies all visible columns when there is no explicit selection", () => {
            const getSelectedRanges = sandbox.stub().returns([]);
            const grid = {
                getColumns: sandbox
                    .stub()
                    .returns(selectionColumns([0, 1, 2, 3], { hiddenSourceColumns: [1, 3] })),
                getSelectionModel: sandbox.stub().returns({ getSelectedRanges }),
            } as unknown as SlickGrid;

            expect(getDisplayedFluentResultGridSelectionForCopy(grid, 3)).to.deep.equal([
                { fromRow: 0, fromCell: 0, toRow: 2, toCell: 0 },
                { fromRow: 0, fromCell: 2, toRow: 2, toCell: 2 },
            ]);
        });

        test("copies every column without an off-by-one when row numbers are disabled", () => {
            const grid = {
                getColumns: sandbox
                    .stub()
                    .returns(selectionColumns([0, 1, 2], { showRowNumberColumn: false })),
                getSelectionModel: sandbox.stub().returns({ getSelectedRanges: () => [] }),
            } as unknown as SlickGrid;

            expect(getDisplayedFluentResultGridSelectionForCopy(grid, 2)).to.deep.equal([
                { fromRow: 0, fromCell: 0, toRow: 1, toCell: 2 },
            ]);
            expect(getDisplayedFluentResultGridSelectionForCopy(grid, 0)).to.deep.equal([]);
        });

        test("copies the source columns represented by a reordered visual selection", () => {
            const grid = {
                getColumns: sandbox.stub().returns(selectionColumns([2, 0, 1])),
                getSelectionModel: sandbox.stub().returns({
                    getSelectedRanges: () => [new SlickRange(1, 1, 1, 2)],
                }),
            } as unknown as SlickGrid;

            expect(getDisplayedFluentResultGridSelectionForCopy(grid, 3)).to.deep.equal([
                { fromRow: 1, fromCell: 0, toRow: 1, toCell: 0 },
                { fromRow: 1, fromCell: 2, toRow: 1, toCell: 2 },
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

        test("coalesces contiguous source rows and splits around missing row mappings", () => {
            const sourceRowsByDisplayRow = [10, 11, undefined, 20, 21];

            expect(
                convertDisplayedSelectionRowsToActual(
                    [{ fromRow: 0, fromCell: 0, toRow: 4, toCell: 2 }],
                    (displayRow) => sourceRowsByDisplayRow[displayRow],
                ),
            ).to.deep.equal([
                { fromRow: 10, fromCell: 0, toRow: 11, toCell: 2 },
                { fromRow: 20, fromCell: 0, toRow: 21, toCell: 2 },
            ]);
        });

        test("builds source-row and displayed-row summary payloads from the same ranges", () => {
            const columns = selectionColumns([2, 0, 1], { hiddenSourceColumns: [0] });
            const sourceRows = [8, 2];

            expect(
                getFluentResultGridSelectionSummaryPayload(
                    [new SlickRange(0, 1, 1, 3)],
                    columns,
                    (displayRow) => sourceRows[displayRow],
                ),
            ).to.deep.equal({
                displaySelection: [
                    { fromRow: 0, fromCell: 2, toRow: 1, toCell: 2 },
                    { fromRow: 0, fromCell: 1, toRow: 1, toCell: 1 },
                ],
                selection: [
                    { fromRow: 8, fromCell: 1, toRow: 8, toCell: 1 },
                    { fromRow: 2, fromCell: 1, toRow: 2, toCell: 1 },
                    { fromRow: 8, fromCell: 2, toRow: 8, toCell: 2 },
                    { fromRow: 2, fromCell: 2, toRow: 2, toCell: 2 },
                ],
            });
        });

        test("maps Save As selections to source rows and keeps no-selection empty", () => {
            const selectedRanges = [new SlickRange(0, 1, 2, 2)];
            const getSelectedRanges = sandbox.stub().returns(selectedRanges);
            const grid = {
                getColumns: sandbox.stub().returns(selectionColumns([0, 1])),
                getDataLength: sandbox.stub().returns(3),
                getSelectionModel: sandbox.stub().returns({ getSelectedRanges }),
            } as unknown as SlickGrid;
            const sourceRowsByDisplayRow = [8, 2, 5];

            expect(
                getFluentResultGridSelectionForSave(
                    grid,
                    (displayRow) => sourceRowsByDisplayRow[displayRow],
                ),
            ).to.deep.equal([
                { fromRow: 8, fromCell: 0, toRow: 8, toCell: 1 },
                { fromRow: 2, fromCell: 0, toRow: 2, toCell: 1 },
                { fromRow: 5, fromCell: 0, toRow: 5, toCell: 1 },
            ]);

            getSelectedRanges.returns([]);
            expect(getFluentResultGridSelectionForSave(grid)).to.deep.equal([]);
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

        test("does not merge diagonal or gapped selection blocks", () => {
            const first = new SlickRange(1, 1, 2, 2);
            const diagonal = new SlickRange(3, 3, 4, 4);
            const gapped = new SlickRange(1, 4, 2, 5);

            expect(insertFluentResultGridSelectionRange([first], diagonal)).to.deep.equal([
                first,
                diagonal,
            ]);
            expect(insertFluentResultGridSelectionRange([first], gapped)).to.deep.equal([
                first,
                gapped,
            ]);
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

    suite("selection summary publication", () => {
        function createPublisher() {
            return Object.assign(sandbox.stub(), { cancel: sandbox.stub() });
        }

        test("cancels stale work and queues nonempty source-row summaries", () => {
            const publishSelectionSummary = createPublisher();
            const onSelectionChange = sandbox.stub();
            const onSelectionSummaryChange = sandbox.stub();

            dispatchFluentResultGridSelectionChange({
                ranges: [new SlickRange(0, 1, 1, 2)],
                columns: selectionColumns([2, 0]),
                transformedRows: [
                    { rowId: 8, cells: [] },
                    { rowId: 2, cells: [] },
                ],
                shouldSuppress: false,
                onSelectionChange,
                onSelectionSummaryChange,
                publishSelectionSummary,
            });

            expect(publishSelectionSummary.cancel).to.have.been.called;
            expect(onSelectionChange).to.have.been.calledWith([
                { fromRow: 0, fromCell: 2, toRow: 1, toCell: 2 },
                { fromRow: 0, fromCell: 0, toRow: 1, toCell: 0 },
            ]);
            expect(publishSelectionSummary).to.have.been.calledWith(
                [
                    { fromRow: 8, fromCell: 0, toRow: 8, toCell: 0 },
                    { fromRow: 2, fromCell: 0, toRow: 2, toCell: 0 },
                    { fromRow: 8, fromCell: 2, toRow: 8, toCell: 2 },
                    { fromRow: 2, fromCell: 2, toRow: 2, toCell: 2 },
                ],
                [
                    { fromRow: 0, fromCell: 2, toRow: 1, toCell: 2 },
                    { fromRow: 0, fromCell: 0, toRow: 1, toCell: 0 },
                ],
            );
            expect(onSelectionSummaryChange).not.to.have.been.called;
        });

        test("publishes an empty summary immediately when selection is cleared", () => {
            const publishSelectionSummary = createPublisher();
            const onSelectionChange = sandbox.stub();
            const onSelectionSummaryChange = sandbox.stub();

            dispatchFluentResultGridSelectionChange({
                ranges: [],
                columns: selectionColumns([0, 1]),
                transformedRows: undefined,
                shouldSuppress: false,
                onSelectionChange,
                onSelectionSummaryChange,
                publishSelectionSummary,
            });

            expect(publishSelectionSummary.cancel).to.have.been.called;
            expect(onSelectionChange).to.have.been.calledWith([]);
            expect(onSelectionSummaryChange).to.have.been.calledWith([], []);
            expect(publishSelectionSummary).not.to.have.been.called;
        });

        test("cancels pending summaries but suppresses callbacks while restoring state", () => {
            const publishSelectionSummary = createPublisher();
            const onSelectionChange = sandbox.stub();
            const onSelectionSummaryChange = sandbox.stub();

            dispatchFluentResultGridSelectionChange({
                ranges: [new SlickRange(0, 1)],
                columns: selectionColumns([0]),
                transformedRows: undefined,
                shouldSuppress: true,
                onSelectionChange,
                onSelectionSummaryChange,
                publishSelectionSummary,
            });

            expect(publishSelectionSummary.cancel).to.have.been.called;
            expect(publishSelectionSummary).not.to.have.been.called;
            expect(onSelectionChange).not.to.have.been.called;
            expect(onSelectionSummaryChange).not.to.have.been.called;
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
        test("matches structured shortcuts exactly and compares character keys case-insensitively", () => {
            const binding = {
                keyCombination: { key: "C", ctrlKey: true },
            };

            expect(
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent({ key: "c", ctrlKey: true }),
                    binding,
                ),
            ).to.equal(true);
            expect(
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent({ key: "c", ctrlKey: true, shiftKey: true }),
                    binding,
                ),
            ).to.equal(false);
            expect(
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent({ key: "c", metaKey: true }),
                    binding,
                ),
            ).to.equal(false);
            expect(
                fluentResultGridEventMatchesShortcut(keyboardEvent({ key: "c", ctrlKey: true }), {
                    keyCombination: "Ctrl+C",
                }),
            ).to.equal(false);
        });

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

        test("maps every configurable command family", () => {
            const commandIds = [
                FluentResultGridCommand.CopySelection,
                FluentResultGridCommand.CopyWithHeaders,
                FluentResultGridCommand.CopyHeaders,
                FluentResultGridCommand.CopyAsCsv,
                FluentResultGridCommand.CopyAsJson,
                FluentResultGridCommand.CopyAsInsertInto,
                FluentResultGridCommand.CopyAsInClause,
                FluentResultGridCommand.SaveAsJson,
                FluentResultGridCommand.SaveAsCsv,
                FluentResultGridCommand.SaveAsExcel,
                FluentResultGridCommand.SaveAsInsert,
                FluentResultGridCommand.SelectAll,
                FluentResultGridCommand.ExpandSelectionLeft,
                FluentResultGridCommand.ExpandSelectionRight,
                FluentResultGridCommand.ExpandSelectionUp,
                FluentResultGridCommand.ExpandSelectionDown,
                FluentResultGridCommand.OpenColumnMenu,
                FluentResultGridCommand.OpenFilter,
                FluentResultGridCommand.MoveToRowStart,
                FluentResultGridCommand.MoveToRowEnd,
                FluentResultGridCommand.SelectColumn,
                FluentResultGridCommand.SelectRow,
                FluentResultGridCommand.ToggleSort,
            ] as const;

            for (const commandId of commandIds) {
                const keyBindings: FluentResultGridKeyBindingMap = {
                    [commandId]: { keyCombination: { code: "F8", altKey: true } },
                };
                expect(
                    getFluentResultGridKeyboardAction(
                        keyboardEvent({ code: "F8", altKey: true }),
                        keyBindings,
                    ),
                    commandId,
                ).to.deep.equal(
                    commandId === FluentResultGridCommand.OpenColumnMenu
                        ? { kind: "openColumnMenu" }
                        : { kind: "command", commandId },
                );
            }
        });

        test("maps Ctrl+Insert to Copy selection", () => {
            const action = getFluentResultGridKeyboardAction(
                keyboardEvent({ code: "Insert", ctrlKey: true, key: "Insert" }),
                {},
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

            expect(
                getFluentResultGridKeyboardAction(
                    keyboardEvent({ code: "KeyA", metaKey: true }),
                    {},
                ),
            ).to.deep.equal({
                kind: "command",
                commandId: FluentResultGridCommand.SelectAll,
            });
        });

        test("does not intercept workbench modifier combinations", () => {
            const events = [
                keyboardEvent({ code: "Tab", ctrlKey: true }),
                keyboardEvent({ code: "Tab", metaKey: true }),
                keyboardEvent({ code: "Tab", altKey: true }),
                keyboardEvent({ code: "Tab", ctrlKey: true, shiftKey: true }),
                keyboardEvent({ code: "KeyA", ctrlKey: true, shiftKey: true }),
                keyboardEvent({ code: "ArrowRight", altKey: true, shiftKey: true }),
                keyboardEvent({ code: "F10", ctrlKey: true, shiftKey: true }),
            ];

            for (const event of events) {
                expect(getFluentResultGridKeyboardAction(event, {})).to.equal(undefined);
            }
        });

        test("recognizes either platform command modifier", () => {
            expect(
                isFluentResultGridMetaOrCtrlKeyPressed(keyboardEvent({ ctrlKey: true })),
            ).to.equal(true);
            expect(
                isFluentResultGridMetaOrCtrlKeyPressed(keyboardEvent({ metaKey: true })),
            ).to.equal(true);
            expect(isFluentResultGridMetaOrCtrlKeyPressed(keyboardEvent({}))).to.equal(false);
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
