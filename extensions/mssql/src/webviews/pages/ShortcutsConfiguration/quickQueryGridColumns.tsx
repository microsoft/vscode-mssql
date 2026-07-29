/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mergeClasses } from "@fluentui/react-components";
import { EraserRegular, Keyboard16Regular, Open16Regular } from "@fluentui/react-icons";
import {
    type Editor,
    type EditorArguments,
    type EditorValidationResult,
} from "@slickgrid-universal/common";
import { type Column } from "slickgrid-react";
import { locConstants } from "../../common/locConstants";

const shortcutKeyboardIconMarkup = renderToStaticMarkup(<Keyboard16Regular aria-hidden />);
const openIconMarkup = renderToStaticMarkup(<Open16Regular aria-hidden />);
const clearIconMarkup = renderToStaticMarkup(<EraserRegular aria-hidden />);

export interface QuickQueryGridRow {
    id: number;
    index: number;
    commandId: string;
    name: string;
    query: string;
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
    onShowAllShortcuts: () => void;
    onEditQuery: (index: number) => void;
    clearQuickQueryValues: (index: number, commandId: string) => void;
}

/**
 * Builds the SlickGrid column definitions for the Quick Queries grid, including the dialog-backed
 * shortcut/query editors and the inline clear cell renderer.
 */
export function useQuickQueryColumns({
    classes,
    loc,
    onRecordShortcut,
    onShowAllShortcuts,
    onEditQuery,
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

        const createShortcutHeader = () => {
            const header = document.createElement("span");
            header.className = classes.quickQueryShortcutHeader;
            header.title = loc.viewConfigureKeybinding;

            const label = document.createElement("span");
            label.className = classes.quickQueryShortcutHeaderText;
            label.textContent = loc.keybinding;

            const button = document.createElement("button");
            button.type = "button";
            button.className = classes.quickQueryShortcutHeaderButton;
            button.textContent = loc.showAllShortcuts;
            button.title = loc.showAllQuickQueryShortcutsTooltip;
            button.setAttribute("aria-label", loc.showAllQuickQueryShortcutsTooltip);
            button.addEventListener("mousedown", (event) => event.stopPropagation());
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                onShowAllShortcuts();
            });

            header.append(label, button);
            return header;
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
                id: "shortcut",
                name: createShortcutHeader(),
                field: "commandId",
                editor: {
                    model: ShortcutDialogEditor,
                    ariaLabel: loc.recordShortcut,
                },
                minWidth: 180,
                width: 230,
                formatter: (_row, _cell, _value, _column, row) => {
                    const cell = createCell(classes.quickQueryShortcutCell);
                    const display = document.createElement("button");
                    display.type = "button";
                    display.className = mergeClasses(
                        classes.vscodeManagedShortcutAction,
                        "vscodeManagedShortcutAction",
                    );
                    display.setAttribute(
                        "aria-label",
                        loc.viewConfigureKeybindingTooltip(row.name),
                    );
                    display.addEventListener("mousedown", (event) => event.stopPropagation());
                    display.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRecordShortcut(row.commandId);
                    });
                    display.addEventListener("keydown", (event) => event.stopPropagation());
                    const text = document.createElement("span");
                    text.className = mergeClasses(
                        classes.vscodeManagedShortcutActionText,
                        "vscodeManagedShortcutActionText",
                    );
                    text.textContent = loc.viewConfigureKeybinding;
                    const openIcon = document.createElement("span");
                    openIcon.className = mergeClasses(
                        classes.vscodeManagedShortcutActionOpenIcon,
                        "vscodeManagedShortcutActionOpenIcon",
                    );
                    openIcon.innerHTML = openIconMarkup;
                    const icon = document.createElement("span");
                    icon.className = classes.vscodeManagedShortcutActionIcon;
                    icon.innerHTML = shortcutKeyboardIconMarkup;
                    display.append(text, openIcon, icon);
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
                    const isEmpty = row.query.trim().length === 0;
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
    }, [classes, clearQuickQueryValues, loc, onEditQuery, onRecordShortcut, onShowAllShortcuts]);
}
