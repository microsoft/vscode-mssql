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
    applyFluentResultGridColumnWidths,
    FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
    getFluentResultGridInitialFrozenColumnIndex,
    normalizeFluentResultGridFrozenColumnIndex,
    shouldApplyFluentResultGridFrozenOptions,
    stabilizeFluentResultGridColumnInfo,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridState";
import { isFluentResultGridHostCommand } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridCommandUtils";
import { shouldRevealFluentResultGridActiveCell } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridKeyboardController";
import {
    getFluentResultGridKeyboardAction,
    type FluentResultGridKeyboardShortcutEvent,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridKeyboard";
import type { SourceRow } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridControllerTypes";
import { updateFluentResultGridHeaderButtonState } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridHeaderController";
import {
    activateFluentResultGridCellWithoutChangingSelection,
    clearFluentResultGridSelection,
    convertDisplayedSelectionRowsToActual,
    countFluentResultGridSelectedRows,
    getDisplayedFluentResultGridSelectionForCopy,
    getFluentResultGridClickSelection,
    getFluentResultGridDataSelectionsFromRanges,
    getFluentResultGridRangesAfterClick,
    getFluentResultGridRangesAfterDrag,
    insertFluentResultGridSelectionRange,
    isFluentResultGridAllCellsSelected,
    setFluentResultGridSelection,
    toggleFluentResultGridSelectedCell,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridSelection";
import { SlickEvent, SlickRange } from "@slickgrid-universal/common";
import type { SlickGrid } from "slickgrid-react";
import { resolveFluentResultGridColumnWindow } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridColumnWindow";
import {
    createFluentResultGridDataRow,
    createFluentResultGridDataView,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridDataView";
import {
    enableFluentResultGridModifierDrag,
    isFluentResultGridAppendSelectionEvent,
    isFluentResultGridSecondaryButtonEvent,
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
    test("preserves host document language metadata in materialized cells", () => {
        const row = createFluentResultGridDataRow(
            [{ displayValue: "{ preview…", isNull: false, languageId: "json" }],
            7,
            1,
        );
        expect(row["0"]).to.include({ rowId: 7, languageId: "json" });
    });

    suite("column windows", () => {
        const wideColumns = [
            { field: "_row", width: 48 },
            ...Array.from({ length: 300 }, (_value, index) => ({
                field: index.toString(),
                width: 100,
            })),
        ];

        test("projects the visible source columns with a reusable overscan band", () => {
            const first = resolveFluentResultGridColumnWindow({
                columns: wideColumns,
                sourceColumnCount: 300,
                viewport: { leftPx: 0, rightPx: 648 },
                options: { minimumColumnCount: 64, overscanColumnCount: 8 },
            });
            expect(first).to.deep.equal({ start: 0, count: 14 });

            const reused = resolveFluentResultGridColumnWindow({
                columns: wideColumns,
                sourceColumnCount: 300,
                viewport: { leftPx: 400, rightPx: 700 },
                options: { minimumColumnCount: 64, overscanColumnCount: 8 },
                currentWindow: first,
            });
            expect(reused).to.equal(first);

            const end = resolveFluentResultGridColumnWindow({
                columns: wideColumns,
                sourceColumnCount: 300,
                viewport: { leftPx: 29_448, rightPx: 30_048 },
                options: { minimumColumnCount: 64, overscanColumnCount: 8 },
                currentWindow: first,
            });
            expect(end).to.deep.equal({ start: 286, count: 14 });
        });

        test("falls back to full rows when frozen or active dependencies span the schema", () => {
            expect(
                resolveFluentResultGridColumnWindow({
                    columns: wideColumns,
                    sourceColumnCount: 300,
                    viewport: { leftPx: 29_448, rightPx: 30_048 },
                    frozenColumnIndex: 1,
                    options: { minimumColumnCount: 64, overscanColumnCount: 8 },
                }),
            ).to.equal(undefined);

            expect(
                resolveFluentResultGridColumnWindow({
                    columns: wideColumns,
                    sourceColumnCount: 300,
                    viewport: { leftPx: 0, rightPx: 648 },
                    activeCellIndex: 300,
                    options: { minimumColumnCount: 64, overscanColumnCount: 8 },
                }),
            ).to.equal(undefined);
        });

        test("keeps narrow schemas on the full-row path", () => {
            expect(
                resolveFluentResultGridColumnWindow({
                    columns: wideColumns.slice(0, 33),
                    sourceColumnCount: 32,
                    viewport: { leftPx: 0, rightPx: 648 },
                    options: { minimumColumnCount: 64 },
                }),
            ).to.equal(undefined);
        });

        test("uses projection only for viewport reads and preserves full-row reads", async () => {
            const testGlobal = globalThis as unknown as {
                requestAnimationFrame?: (callback: FrameRequestCallback) => number;
                cancelAnimationFrame?: (handle: number) => void;
            };
            const previousRequestAnimationFrame = testGlobal.requestAnimationFrame;
            const previousCancelAnimationFrame = testGlobal.cancelAnimationFrame;
            testGlobal.requestAnimationFrame = () => 1;
            testGlobal.cancelAnimationFrame = () => undefined;
            const requests: Array<{
                offset: number;
                count: number;
                start?: number;
                columns?: number;
                purpose?: "viewport" | "authoritative";
            }> = [];
            const dataView = createFluentResultGridDataView({
                columnCount: 300,
                windowSize: 10,
                dataSource: {
                    kind: "windowed",
                    rowCount: 100,
                    columnWindowing: { minimumColumnCount: 64, overscanColumnCount: 8 },
                    getRows: (offset, count, columnWindow, readPurpose) => {
                        requests.push({
                            offset,
                            count,
                            start: columnWindow?.start,
                            columns: columnWindow?.count,
                            purpose: readPurpose,
                        });
                        return Array.from({ length: count }, () => []);
                    },
                },
            });
            dataView.setLength(100, true);
            dataView.refresh(0);
            // SlickGrid probes rows synchronously in its constructor, before
            // the data view receives the grid and can resolve column pixels.
            expect(dataView.getItem(0)).to.not.equal(undefined);
            expect(requests).to.deep.equal([]);
            let viewport = { top: 0, bottom: 5, leftPx: 0, rightPx: 648 };
            const grid = {
                onViewportChanged: new SlickEvent(),
                onScroll: new SlickEvent(),
                onColumnsResized: new SlickEvent(),
                onColumnsReordered: new SlickEvent(),
                getViewport: () => viewport,
                getColumns: () => wideColumns,
                getOptions: () => ({ frozenColumn: -1 }),
                getActiveCell: () => undefined,
                invalidateAllRows: () => undefined,
                invalidateRows: () => undefined,
                updateRowCount: () => undefined,
                render: () => undefined,
            } as unknown as SlickGrid;

            dataView.setGrid(grid);
            await Promise.resolve();
            expect(requests.length).to.be.greaterThan(0);
            expect(
                requests.every(
                    (request) =>
                        request.start === 0 &&
                        request.columns === 14 &&
                        request.purpose === "viewport",
                ),
            ).to.equal(true);

            dataView.setLength(100, true);
            dataView.refresh(0);
            await Promise.resolve();
            expect(
                requests.every(
                    (request) => request.start !== undefined && request.purpose === "viewport",
                ),
            ).to.equal(true);

            viewport = { top: 0, bottom: 5, leftPx: 29_448, rightPx: 30_048 };
            dataView.ensureViewportLoaded();
            await Promise.resolve();
            expect(
                requests.some((request) => request.start === 286 && request.columns === 14),
            ).to.equal(true);

            await dataView.getRangeAsync(0, 1);
            expect(requests.at(-1)).to.deep.equal({
                offset: 0,
                count: 1,
                start: undefined,
                columns: undefined,
                purpose: "authoritative",
            });
            dataView.dispose();
            if (previousRequestAnimationFrame) {
                testGlobal.requestAnimationFrame = previousRequestAnimationFrame;
            } else {
                delete testGlobal.requestAnimationFrame;
            }
            if (previousCancelAnimationFrame) {
                testGlobal.cancelAnimationFrame = previousCancelAnimationFrame;
            } else {
                delete testGlobal.cancelAnimationFrame;
            }
        });

        test("fetches only the appended suffix when a streaming viewport grows", async () => {
            const requests: Array<{ offset: number; count: number }> = [];
            const dataView = createFluentResultGridDataView({
                columnCount: 1,
                windowSize: 50,
                dataSource: {
                    kind: "windowed",
                    rowCount: 1,
                    getRows: (offset, count) => {
                        requests.push({ offset, count });
                        return Array.from({ length: count }, (_value, index) => [
                            cell(`row-${offset + index}`),
                        ]);
                    },
                },
            });

            dataView.refresh(0);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(requests).to.deep.equal([{ offset: 0, count: 1 }]);

            dataView.setLength(2);
            dataView.getItem(1);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(requests).to.deep.equal([
                { offset: 0, count: 1 },
                { offset: 1, count: 1 },
            ]);
            expect(dataView.getLoadedRange(0, 2).map((row) => row.id)).to.deep.equal([0, 1]);

            // A real identity reset still invalidates and reloads the full
            // current window; suffix reuse is only for immutable growth.
            dataView.setLength(2, true);
            dataView.refresh(0);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(requests.at(-1)).to.deep.equal({ offset: 0, count: 2 });
            dataView.dispose();
        });

        test("streaming row growth defers updateRowCount while the viewport scrolls", async () => {
            // SlickGrid's updateRowCount() reaches scrollTo(), which writes
            // the viewport scrollTop when the page/offset mapping shifts —
            // mid-drag that teleports the scrollbar thumb (block jumps,
            // sometimes against the drag direction). Streaming growth must
            // wait for a scroll-quiet window.
            const testGlobal = globalThis as unknown as Record<string, unknown>;
            const previousRequestAnimationFrame = testGlobal.requestAnimationFrame;
            const previousCancelAnimationFrame = testGlobal.cancelAnimationFrame;
            testGlobal.requestAnimationFrame = () => 1;
            testGlobal.cancelAnimationFrame = () => undefined;
            let updateRowCountCalls = 0;
            const dataView = createFluentResultGridDataView({
                columnCount: 1,
                dataSource: {
                    kind: "windowed",
                    rowCount: 1,
                    getRows: (offset, count) =>
                        Array.from({ length: count }, (_value, index) => [
                            cell(`row-${offset + index}`),
                        ]),
                },
            });
            const onScroll = new SlickEvent();
            const grid = {
                onViewportChanged: new SlickEvent(),
                onScroll,
                onColumnsResized: new SlickEvent(),
                onColumnsReordered: new SlickEvent(),
                getViewport: () => ({ top: 0, bottom: 5, leftPx: 0, rightPx: 100 }),
                getColumns: () => [],
                getOptions: () => ({ frozenColumn: -1 }),
                getActiveCell: () => undefined,
                invalidateAllRows: () => undefined,
                invalidateRows: () => undefined,
                updateRowCount: () => {
                    updateRowCountCalls++;
                },
                render: () => undefined,
            } as unknown as SlickGrid;
            dataView.setGrid(grid);

            // Quiet viewport: row growth relayouts immediately.
            dataView.setLength(5);
            expect(updateRowCountCalls).to.equal(1);

            // Scrolling viewport: growth arriving mid-scroll is deferred…
            onScroll.notify({} as never);
            dataView.setLength(10);
            expect(updateRowCountCalls).to.equal(1);

            // …and flushes once the viewport has been quiet long enough.
            await new Promise<void>((resolve) => setTimeout(resolve, 450));
            expect(updateRowCountCalls).to.equal(2);
            dataView.dispose();
            if (previousRequestAnimationFrame) {
                testGlobal.requestAnimationFrame = previousRequestAnimationFrame;
            } else {
                delete testGlobal.requestAnimationFrame;
            }
            if (previousCancelAnimationFrame) {
                testGlobal.cancelAnimationFrame = previousCancelAnimationFrame;
            } else {
                delete testGlobal.cancelAnimationFrame;
            }
        });

        test("retries an incomplete window instead of treating placeholders as loaded", async () => {
            let requests = 0;
            const dataView = createFluentResultGridDataView({
                columnCount: 1,
                dataSource: {
                    kind: "windowed",
                    rowCount: 1,
                    getRows: () => {
                        requests++;
                        return requests === 1 ? [] : [[cell("recovered")]];
                    },
                },
            });

            dataView.refresh(0);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(dataView.getLoadedRange(0, 1)).to.deep.equal([]);

            dataView.getItem(0);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(requests).to.equal(2);
            expect(dataView.getLoadedRange(0, 1)).to.have.length(1);
            dataView.dispose();
        });
    });

    suite("header state", () => {
        test("updates only the supplied header's filter and sort buttons", () => {
            const filterClasses = new Set<string>();
            const sortClasses = new Set<string>(["sorted-desc"]);
            const classList = (classes: Set<string>) =>
                ({
                    add: (...tokens: string[]) => tokens.forEach((token) => classes.add(token)),
                    remove: (...tokens: string[]) =>
                        tokens.forEach((token) => classes.delete(token)),
                    toggle: (token: string, force?: boolean) => {
                        const enabled = force ?? !classes.has(token);
                        if (enabled) {
                            classes.add(token);
                        } else {
                            classes.delete(token);
                        }
                        return enabled;
                    },
                }) as DOMTokenList;
            const filterButton = { classList: classList(filterClasses) } as HTMLButtonElement;
            const sortButton = { classList: classList(sortClasses) } as HTMLButtonElement;
            const headerNode = {
                querySelector: (selector: string) =>
                    selector === ".slick-header-filterbutton" ? filterButton : sortButton,
            } as unknown as HTMLElement;

            updateFluentResultGridHeaderButtonState({
                headerNode,
                columnId: "299",
                filters: {
                    "299": { columnDef: "299", filterValues: ["active"] },
                },
                sort: { columnId: "299", direction: SortProperties.ASC },
            });

            expect([...filterClasses]).to.deep.equal(["filtered"]);
            expect([...sortClasses]).to.deep.equal(["sorted-asc"]);
        });
    });

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
        test("counts large overlapping row selections without row expansion", () => {
            expect(
                countFluentResultGridSelectedRows([
                    { fromRow: 0, toRow: 99_999_999, fromCell: 0, toCell: 0 },
                    { fromRow: 25, toRow: 50, fromCell: 3, toCell: 5 },
                    { fromRow: 100_000_001, toRow: 100_000_005, fromCell: 1, toCell: 1 },
                    { fromRow: 100_000_000, toRow: 100_000_000, fromCell: 2, toCell: 2 },
                    { fromRow: 9, toRow: 8, fromCell: 0, toCell: 0 },
                ]),
            ).to.equal(100_000_006);
        });

        test("recognizes an already-restored full-grid selection", () => {
            expect(
                isFluentResultGridAllCellsSelected([new SlickRange(0, 1, 99_999, 4)], 100_000, 5),
            ).to.equal(true);
            expect(
                isFluentResultGridAllCellsSelected([new SlickRange(0, 1, 99_998, 4)], 100_000, 5),
            ).to.equal(false);
            expect(isFluentResultGridAllCellsSelected([], 100_000, 5)).to.equal(false);
        });

        test("applies autosize widths without replacing column identities", () => {
            const columns = [
                { id: "0", width: 100 },
                { id: "1", width: 100, rerenderOnResize: true },
                { id: "2", width: 80 },
            ] as unknown as Parameters<typeof applyFluentResultGridColumnWidths>[0];

            expect(applyFluentResultGridColumnWidths(columns, [100, 140, 90])).to.deep.equal({
                changed: true,
                rerender: true,
            });
            expect(columns.map((column) => column.width)).to.deep.equal([100, 140, 90]);
            expect(applyFluentResultGridColumnWidths(columns, [100, 140, 90])).to.deep.equal({
                changed: false,
                rerender: false,
            });
        });

        test("skips an already-applied initial frozen-column configuration", () => {
            expect(
                shouldApplyFluentResultGridFrozenOptions(
                    {
                        alwaysShowVerticalScroll: false,
                        enableMouseWheelScrollHandler: true,
                        frozenColumn: -1,
                        skipFreezeColumnValidation: true,
                    },
                    -1,
                ),
            ).to.equal(false);
            expect(
                shouldApplyFluentResultGridFrozenOptions(
                    {
                        alwaysShowVerticalScroll: false,
                        enableMouseWheelScrollHandler: true,
                        frozenColumn: -1,
                        skipFreezeColumnValidation: true,
                    },
                    4,
                ),
            ).to.equal(true);
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

        test("orders copied ranges by their displayed rows", () => {
            const grid = {
                getColumns: () => [{}, {}, {}, {}],
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
