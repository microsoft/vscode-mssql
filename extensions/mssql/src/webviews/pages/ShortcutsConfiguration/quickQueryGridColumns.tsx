/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mergeClasses } from "@fluentui/react-components";
import { EraserRegular, Keyboard16Regular } from "@fluentui/react-icons";
import {
    type Editor,
    type EditorArguments,
    type EditorValidationResult,
} from "@slickgrid-universal/common";
import { type Column } from "slickgrid-react";
import { locConstants } from "../../common/locConstants";
import {
    QuickQueryExecutionMode,
    QuickQuerySlot,
} from "../../../sharedInterfaces/shortcutsConfiguration";
import { formatShortcut } from "./shortcutKeyboardUtils";

const shortcutKeyboardIconMarkup = renderToStaticMarkup(<Keyboard16Regular aria-hidden />);
const clearIconMarkup = renderToStaticMarkup(<EraserRegular aria-hidden />);

export interface QuickQueryGridRow {
    id: number;
    index: number;
    commandId: string;
    slot: QuickQuerySlot;
    name: string;
    query: string;
    shortcut: string;
    autoExecute: boolean;
}

function createDialogEditor(openDialog: (row: QuickQueryGridRow) => void) {
    return class DialogEditor implements Editor {
        static suppressClearOnEdit = true;
        dataContext?: QuickQueryGridRow;
        private animationFrame: number | undefined;

        constructor(private readonly args: EditorArguments) {
            this.dataContext = args.item as QuickQueryGridRow;
            this.init();
        }

        init(): void {
            this.animationFrame = window.requestAnimationFrame(() => {
                this.animationFrame = undefined;
                this.args.cancelChanges();
                openDialog(this.dataContext!);
            });
        }

        destroy(): void {
            if (this.animationFrame !== undefined) {
                window.cancelAnimationFrame(this.animationFrame);
                this.animationFrame = undefined;
            }
        }

        focus(): void {}

        loadValue(): void {}

        applyValue(): void {}

        serializeValue(): string {
            return "";
        }

        isValueChanged(): boolean {
            return false;
        }

        validate(): EditorValidationResult {
            return { valid: true, msg: null };
        }
    };
}

export interface UseQuickQueryColumnsParams {
    classes: Record<string, string>;
    loc: typeof locConstants.shortcutsConfiguration;
    onRecordShortcut: (commandId: string) => void;
    onEditQuery: (index: number) => void;
    updateQuickQuery: (index: number, value: QuickQuerySlot) => void;
    clearQuickQueryValues: (index: number, commandId: string) => void;
}

/**
 * Builds the SlickGrid column definitions for the Quick Queries grid, including the dialog-backed
 * shortcut/query editors and the inline auto-execute and clear cell renderers.
 */
export function useQuickQueryColumns({
    classes,
    loc,
    onRecordShortcut,
    onEditQuery,
    updateQuickQuery,
    clearQuickQueryValues,
}: UseQuickQueryColumnsParams): Column<QuickQueryGridRow>[] {
    return useMemo<Column<QuickQueryGridRow>[]>(() => {
        const ShortcutDialogEditor = createDialogEditor((row) => onRecordShortcut(row.commandId));
        const QueryDialogEditor = createDialogEditor((row) => onEditQuery(row.index));

        const createCell = (className?: string) => {
            const cell = document.createElement("div");
            cell.className = mergeClasses(classes.quickQueryCell, className);
            return cell;
        };

        return [
            {
                id: "name",
                name: loc.name,
                field: "name",
                minWidth: 140,
                width: 170,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell();
                    const display = document.createElement("span");
                    display.className = classes.quickQueryTextDisplay;
                    display.textContent = row.name;
                    display.title = row.name;
                    cell.append(display);
                    return cell;
                },
            },
            {
                id: "autoExecute",
                name: loc.autoExecute,
                field: "autoExecute",
                cssClass: classes.quickQueryCenteredCell,
                maxWidth: 115,
                minWidth: 105,
                width: 110,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell(classes.quickQueryCenteredCell);
                    const setAutoExecute = (autoExecute: boolean) => {
                        const executionMode = autoExecute
                            ? QuickQueryExecutionMode.OpenAndRun
                            : QuickQueryExecutionMode.Open;
                        if (executionMode !== row.slot.executionMode) {
                            updateQuickQuery(row.index, {
                                ...row.slot,
                                executionMode,
                            });
                        }
                    };
                    cell.addEventListener("mousedown", (event) => event.stopPropagation());
                    cell.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setAutoExecute(!row.autoExecute);
                    });
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = row.autoExecute;
                    checkbox.className = classes.quickQueryCheckboxInput;
                    checkbox.setAttribute("aria-label", `${loc.autoExecute}: ${row.name}`);
                    checkbox.addEventListener("mousedown", (event) => event.stopPropagation());
                    checkbox.addEventListener("click", (event) => {
                        event.stopPropagation();
                        setAutoExecute((event.currentTarget as HTMLInputElement).checked);
                    });
                    checkbox.addEventListener("keydown", (event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                            event.preventDefault();
                            setAutoExecute(!row.autoExecute);
                        }
                    });
                    cell.append(checkbox);
                    return cell;
                },
            },
            {
                id: "shortcut",
                name: loc.shortcut,
                field: "shortcut",
                editor: {
                    model: ShortcutDialogEditor,
                    ariaLabel: loc.recordShortcut,
                },
                minWidth: 205,
                width: 230,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell(classes.quickQueryShortcutCell);
                    const displayValue = formatShortcut(row.shortcut) || loc.noShortcut;
                    const display = document.createElement("span");
                    display.className = mergeClasses(
                        classes.quickQueryShortcutDisplay,
                        !row.shortcut && classes.quickQueryEmpty,
                    );
                    display.title = displayValue;
                    const icon = document.createElement("span");
                    icon.className = classes.quickQueryShortcutIcon;
                    icon.innerHTML = shortcutKeyboardIconMarkup;
                    const text = document.createElement("span");
                    text.className = classes.quickQueryShortcutText;
                    text.textContent = displayValue;
                    display.append(text, icon);
                    cell.append(display);
                    return cell;
                },
            },
            {
                id: "query",
                name: loc.query,
                field: "query",
                editor: {
                    model: QueryDialogEditor,
                    ariaLabel: loc.query,
                },
                minWidth: 260,
                width: 420,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell(classes.quickQueryQueryCell);
                    const query = row.query.trim().replace(/\s+/g, " ");
                    const preview = query.length > 90 ? `${query.slice(0, 90)}...` : query;
                    const previewElement = document.createElement("span");
                    previewElement.className = preview
                        ? classes.quickQueryPreview
                        : classes.quickQueryNoQuery;
                    previewElement.textContent = preview || loc.noQuerySet;
                    previewElement.title = preview || loc.noQuerySet;
                    cell.append(previewElement);
                    return cell;
                },
            },
            {
                id: "clear",
                name: "",
                field: "id",
                cssClass: classes.quickQueryCenteredCell,
                excludeFromColumnPicker: true,
                maxWidth: 46,
                minWidth: 42,
                width: 44,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell(classes.quickQueryCenteredCell);
                    const button = document.createElement("button");
                    const isEmpty =
                        row.query.trim().length === 0 &&
                        row.shortcut.trim().length === 0 &&
                        row.slot.executionMode === QuickQueryExecutionMode.Open;
                    button.type = "button";
                    button.className = classes.quickQueryClearButton;
                    button.disabled = isEmpty;
                    button.title = loc.clearQuickQueryTooltip;
                    button.setAttribute("aria-label", `${loc.clearQuickQueryTooltip}: ${row.name}`);
                    button.innerHTML = clearIconMarkup;
                    button.addEventListener("mousedown", (event) => event.stopPropagation());
                    button.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        clearQuickQueryValues(row.index, row.commandId);
                    });
                    cell.append(button);
                    return cell;
                },
            },
        ];
    }, [classes, clearQuickQueryValues, loc, onEditQuery, onRecordShortcut, updateQuickQuery]);
}
