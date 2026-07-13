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
