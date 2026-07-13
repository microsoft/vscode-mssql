/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    SortProperties,
    type ColumnFilterMap,
    type DbCellValue,
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
    normalizeFluentResultGridFrozenColumnIndex,
    shouldApplyFluentResultGridFrozenOptions,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridState";
import { isFluentResultGridHostCommand } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridCommandUtils";
import {
    getFluentResultGridKeyboardAction,
    type FluentResultGridKeyboardShortcutEvent,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridKeyboard";
import type { SourceRow } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridControllerTypes";
import { updateFluentResultGridHeaderButtonState } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridHeaderController";
import {
    countFluentResultGridSelectedRows,
    isFluentResultGridAllCellsSelected,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridSelection";
import { SlickEvent, SlickRange, type SlickGrid } from "@slickgrid-universal/common";
import { resolveFluentResultGridColumnWindow } from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridColumnWindow";
import {
    createFluentResultGridDataRow,
    createFluentResultGridDataView,
} from "../../src/webviews/common/FluentResultGrid/internal/fluentResultGridDataView";

function cell(value: string | null): DbCellValue {
    return {
        displayValue: value ?? "",
        isNull: value === null,
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
            }> = [];
            const dataView = createFluentResultGridDataView({
                columnCount: 300,
                windowSize: 10,
                dataSource: {
                    kind: "windowed",
                    rowCount: 100,
                    columnWindowing: { minimumColumnCount: 64, overscanColumnCount: 8 },
                    getRows: (offset, count, columnWindow) => {
                        requests.push({
                            offset,
                            count,
                            start: columnWindow?.start,
                            columns: columnWindow?.count,
                        });
                        return Array.from({ length: count }, () => []);
                    },
                },
            });
            dataView.setLength(100, true);
            dataView.refresh(0);
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
                requests.every((request) => request.start === 0 && request.columns === 14),
            ).to.equal(true);

            dataView.setLength(100, true);
            dataView.refresh(0);
            await Promise.resolve();
            expect(requests.every((request) => request.start !== undefined)).to.equal(true);

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
    });
});
