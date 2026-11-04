/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    mergeClasses,
    PositioningVirtualElement,
    tokens,
} from "@fluentui/react-components";
import { Copy16Regular } from "@fluentui/react-icons";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Column,
    GridOption,
    OnClickEventArgs,
    OnContextMenuArgs,
    OnKeyDownEventArgs,
    SlickEventData,
    SlickGrid,
    SlickgridReactInstance,
    SortComparer,
    SortDirectionNumber,
} from "slickgrid-react";
import {
    CopyTextRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
} from "../../../sharedInterfaces/performanceDashboard";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
    FluentSlickGrid,
    getFluentSlickGridSelectionText,
} from "../../common/FluentSlickGrid/FluentSlickGrid";
import { locConstants as loc } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useFadeInClass } from "./performanceDashboardSkeletons";
import "./performanceDashboardGrid.css";

const rowHeight = 32;
/** The header row and the frame around the grid. */
const chromeHeight = rowHeight + 2;
const defaultWidth = 120;
const controlWidth = 36;
/** The narrowest that the user can make a column. */
const minColumnWidth = 48;
const svgNamespace = "http://www.w3.org/2000/svg";
// The 16px Fluent icon of the button that opens a row's menu.
const moreIconPath =
    "M5 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z";
// The 12px Fluent check mark of a check box.
const checkmarkIconPath =
    "M9.76 3.2c.3.29.32.76.04 1.06l-4.25 4.5a.75.75 0 0 1-1.08.02L2.22 6.53a.75.75 0 0 1 1.06-1.06l1.7 1.7L8.7 3.24a.75.75 0 0 1 1.06-.04Z";
const menuColumnId = "__menu";

let nextGridNumber = 0;

export type DashboardGridSortValue = string | number | boolean | undefined;

export interface DashboardGridColumn<T> {
    readonly id: string;
    readonly header: string;
    /** The text of the cell: what it shows, unless it draws itself, and what it copies. */
    readonly text: (item: T) => string;
    /**
     * Draws the cell instead of the text, such as a link or a bar. The grid draws its cells
     * outside React, so this returns DOM, from the helpers in this module.
     */
    readonly render?: (item: T) => HTMLElement;
    /** The tooltip of the cell. */
    readonly title?: (item: T) => string | undefined;
    /** Copies this instead of the text, such as the whole of a shortened query text. */
    readonly copyText?: (item: T) => string;
    /** Sorts the column by this value. Without it, the column does not sort. */
    readonly sortValue?: (item: T) => DashboardGridSortValue;
    readonly numeric?: boolean;
    /** The width; a column that grows has at least this width. Default 120. */
    readonly width?: number;
    /**
     * Takes the width left, so the grid fills its frame. Without a column that grows, the
     * columns keep their widths, and the space after them is empty.
     */
    readonly grow?: boolean;
    /** A button or a check box: centered, without padding, and not copied. */
    readonly control?: boolean;
    /** Runs the link or the button of the cell, from a click on it or Enter or Space on the cell. */
    readonly activate?: (item: T) => void;
}

export interface DashboardGridProps<T> {
    readonly items: readonly T[];
    readonly columns: readonly DashboardGridColumn<T>[];
    readonly getRowId: (item: T) => string;
    readonly ariaLabel: string;
    /** The sort shown when the grid opens. */
    readonly defaultSort?: {
        readonly column: string;
        readonly direction: "ascending" | "descending";
    };
    /** Highlights a row, for example a selected plan. */
    readonly isSelected?: (item: T) => boolean;
    /** The items of a row's context menu after Copy, such as actions on the row. */
    readonly menuItems?: (item: T) => ReactNode;
    /** The label of a button at the end of each row that opens the row's menu. */
    readonly menuButtonLabel?: (item: T) => string;
    /** The rows that the grid shows at least, before the page scrolls instead. Default 5. */
    readonly visibleRows?: number;
    /** False leaves out the frame, for a grid inside a panel. Default true. */
    readonly framed?: boolean;
}

/** A row of the grid: the item, and the text and sort value of each column. */
interface GridRow<T> {
    readonly rowId: string;
    readonly item: T;
    readonly selected: boolean;
    readonly [field: string]: unknown;
}

const copyField = (columnId: string) => `copy:${columnId}`;
const sortField = (columnId: string) => `sort:${columnId}`;

const useStyles = makeStyles({
    // The slot takes the space left below the grid's siblings, and the grid fills it.
    slot: {
        flex: "1 1 0px",
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
    },
    framed: {
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: tokens.borderRadiusMedium,
    },
});

/**
 * A dashboard grid on FluentSlickGrid, in the colors of the theme. It fills the space left below
 * its siblings, sorts from its headers, and copies the selected cells from its context menu or
 * with Ctrl+C. The menu can have actions on the row after Copy.
 */
export function DashboardGrid<T>({
    items,
    columns,
    getRowId,
    ariaLabel,
    defaultSort,
    isSelected,
    menuItems,
    menuButtonLabel,
    visibleRows = 5,
    framed = true,
}: DashboardGridProps<T>) {
    const classes = useStyles();
    const fadeIn = useFadeInClass();
    const { themeKind, extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const isDark = themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast;
    const reactGrid = useRef<SlickgridReactInstance | undefined>(undefined);
    const gridNumber = useRef(0);
    if (gridNumber.current === 0) {
        gridNumber.current = ++nextGridNumber;
    }
    const gridId = `performanceGrid${gridNumber.current}`;
    const containerId = `${gridId}Container`;
    const [menu, setMenu] = useState<
        { readonly item: T; readonly target: PositioningVirtualElement | HTMLElement } | undefined
    >(undefined);

    // The columns with the menu button. The cells draw from the newest columns, so a column
    // that changes only how it draws does not make new grid columns.
    const allColumns = useMemo<readonly DashboardGridColumn<T>[]>(
        () =>
            menuButtonLabel
                ? [
                      ...columns,
                      {
                          id: menuColumnId,
                          header: "",
                          control: true,
                          text: () => "",
                          render: (item) => iconButton(moreIconPath, menuButtonLabel(item)),
                      },
                  ]
                : columns,
        [columns, menuButtonLabel],
    );
    const latestColumns = useRef(allColumns);
    latestColumns.current = allColumns;

    const shape = allColumns
        .map((column) =>
            [
                column.id,
                column.header,
                column.width,
                column.grow,
                column.numeric,
                column.control,
                !!column.sortValue,
            ].join("|"),
        )
        .join("\n");
    const definitions = useMemo<Column[]>(
        () =>
            latestColumns.current.map((column): Column => {
                const width = column.width ?? (column.control ? controlWidth : defaultWidth);
                // The user can resize every column but a control.
                return {
                    id: column.id,
                    name: column.header,
                    field: copyField(column.id),
                    queryFieldSorter: sortField(column.id),
                    width,
                    minWidth: column.control ? width : Math.min(width, minColumnWidth),
                    ...(column.control ? { maxWidth: width } : {}),
                    resizable: !column.control,
                    sortable: !!column.sortValue,
                    sortComparer: compareSortValues,
                    cssClass: column.control
                        ? "performance-grid-control"
                        : column.numeric
                          ? "performance-grid-number"
                          : undefined,
                    formatter: (_row, _cell, _value, _column, row: GridRow<T>) =>
                        drawCell(latestColumns.current, column.id, row.item),
                };
            }),
        // The shape of the columns is all that the grid columns are made from.
        [shape],
    );
    // The widths below which the columns that grow do not go: their own, or the user's.
    const growFloors = useRef(new Map<string, number>());
    const growKey = allColumns
        .filter((column) => column.grow)
        .map((column) => `${column.id}:${column.width ?? defaultWidth}`)
        .join();
    useEffect(() => {
        growFloors.current = new Map(
            growKey
                .split(",")
                .filter(Boolean)
                .map((entry) => {
                    const [id, width] = entry.split(":");
                    return [id, Number(width)];
                }),
        );
    }, [growKey]);

    /**
     * Gives the columns that grow the width that the others leave, so the grid fills its frame.
     * SlickGrid's own fit would widen every column in proportion, and the user resizes them.
     */
    const fillWidth = useCallback(() => {
        const grid = reactGrid.current?.slickGrid;
        const viewport = grid?.getViewportNode();
        if (!grid || !viewport || growFloors.current.size === 0) {
            return;
        }
        const gridColumns = grid.getColumns();
        const growing = gridColumns.filter((column) => growFloors.current.has(String(column.id)));
        const fixed = gridColumns
            .filter((column) => !growFloors.current.has(String(column.id)))
            .reduce((sum, column) => sum + (column.width ?? 0), 0);
        const share = Math.floor((viewport.clientWidth - fixed) / Math.max(1, growing.length));
        let changed = false;
        for (const column of growing) {
            const width = Math.max(growFloors.current.get(String(column.id)) ?? 0, share);
            if (column.width !== width) {
                column.width = width;
                changed = true;
            }
        }
        if (changed) {
            grid.reRenderColumns(false);
        }
    }, []);

    // The frame resizes with the page, and a vertical scroll bar narrows the rows.
    const [viewport, setViewport] = useState<HTMLElement | undefined>(undefined);
    useEffect(() => {
        if (!viewport) {
            return;
        }
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(fillWidth);
        });
        observer.observe(viewport);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [viewport, fillWidth]);

    // New rows only when what the cells show or sort by changes, so the grid does not take the
    // same rows again on each render. A control shows the row's selection or its sort value.
    const builtRows = items.map((item) => {
        const row: Record<string, unknown> = {
            rowId: getRowId(item),
            selected: isSelected?.(item) ?? false,
        };
        for (const column of allColumns) {
            row[copyField(column.id)] = column.control
                ? ""
                : (column.copyText ?? column.text)(item);
            row[sortField(column.id)] = column.sortValue?.(item);
            row[`title:${column.id}`] = column.title?.(item);
        }
        return { row, item };
    });
    const rowsKey = JSON.stringify(builtRows.map(({ row }) => row));
    const latestRows = useRef(builtRows);
    latestRows.current = builtRows;
    const dataset = useMemo<GridRow<T>[]>(
        () => latestRows.current.map(({ row, item }) => ({ ...row, item }) as GridRow<T>),
        [rowsKey],
    );

    // The grid takes the new rows before this runs, but redraws only rows with a new ID, so it
    // must redraw a row whose item is the same, such as a plan that was selected.
    useEffect(() => {
        reactGrid.current?.slickGrid?.invalidate();
    }, [dataset]);

    const copySelection = useCallback(() => {
        const text = getFluentSlickGridSelectionText(reactGrid.current);
        if (text) {
            void extensionRpc.sendRequest(CopyTextRequest.type, { text });
        }
    }, [extensionRpc]);

    // The grid reads its options once, when it is created.
    const sortColumn = defaultSort?.column;
    const sortDirection = defaultSort?.direction;
    const options = useMemo<GridOption>(
        () => ({
            ...baseFluentReadOnlyGridOption,
            datasetIdPropertyName: "rowId",
            // The grid takes the whole slot, also when its rows are fewer than fit in it.
            autoResize: createFluentAutoResizeOptions(`#${containerId}`, {
                autoHeight: false,
                bottomPadding: 0,
                minHeight: chromeHeight + rowHeight,
            }),
            // The columns keep their widths, and the ones that grow fill the rest: see fillWidth.
            forceFitColumns: false,
            enableAutoSizeColumns: false,
            rowHeight,
            enableAutoTooltip: false,
            enableColumnReorder: false,
            enableSorting: true,
            presets: sortColumn
                ? {
                      sorters: [
                          {
                              columnId: sortColumn,
                              direction: sortDirection === "ascending" ? "ASC" : "DESC",
                          },
                      ],
                  }
                : undefined,
            // The grid copies the cells itself, so that Ctrl+C and the menu copy the same.
            enableExcelCopyBuffer: false,
            enableSelection: true,
            selectionOptions: { selectionType: "cell", showDragHandle: false },
            // The grid shows a Fluent menu instead of its own.
            enableContextMenu: false,
            dataView: {
                globalItemMetadataProvider: {
                    getRowMetadata: (row: GridRow<T>) =>
                        row.selected ? { cssClasses: "performance-grid-row-selected" } : undefined,
                },
            },
            darkMode: isDark,
        }),
        [containerId, sortColumn, sortDirection, isDark],
    );

    const activateCell = (grid: SlickGrid, row: number, cell: number): boolean => {
        const gridRow = grid.getDataItem(row) as GridRow<T> | undefined;
        const columnId = String(grid.getColumns()[cell]?.id);
        if (!gridRow) {
            return false;
        }
        if (columnId === menuColumnId) {
            const node = grid.getCellNode(row, cell)?.querySelector("button");
            if (node) {
                setMenu({ item: gridRow.item, target: node });
            }
            return true;
        }
        const column = latestColumns.current.find((candidate) => candidate.id === columnId);
        if (!column?.activate) {
            return false;
        }
        column.activate(gridRow.item);
        return true;
    };

    /** Opens the menu of a cell, after it selects the cell when it is not in the selection. */
    const openMenu = (
        grid: SlickGrid,
        row: number,
        cell: number,
        target: PositioningVirtualElement | HTMLElement,
    ) => {
        const gridRow = grid.getDataItem(row) as GridRow<T> | undefined;
        if (!gridRow) {
            return;
        }
        const ranges = grid.getSelectionModel()?.getSelectedRanges() ?? [];
        if (!ranges.some((range) => range.contains(row, cell))) {
            grid.setActiveCell(row, cell);
        }
        setMenu({ item: gridRow.item, target });
    };

    const handleClick = (
        event: CustomEvent<{ eventData: SlickEventData; args: OnClickEventArgs }>,
    ) => {
        const { eventData, args } = event.detail;
        const target = eventData.target as Element | undefined;
        if (
            target?.closest("a, button, [role='checkbox']") &&
            activateCell(args.grid, args.row, args.cell)
        ) {
            eventData.preventDefault();
        }
    };
    const handleKeyDown = (
        event: CustomEvent<{ eventData: SlickEventData; args: OnKeyDownEventArgs }>,
    ) => {
        const { eventData, args } = event.detail;
        if ((eventData.ctrlKey || eventData.metaKey) && eventData.key?.toLowerCase() === "c") {
            copySelection();
            eventData.preventDefault();
        } else if (
            eventData.key === "ContextMenu" ||
            (eventData.shiftKey && eventData.key === "F10")
        ) {
            const node = args.grid.getCellNode(args.row, args.cell);
            if (node) {
                openMenu(args.grid, args.row, args.cell, node);
                eventData.preventDefault();
            }
        } else if (
            (eventData.key === "Enter" || eventData.key === " ") &&
            activateCell(args.grid, args.row, args.cell)
        ) {
            eventData.preventDefault();
        }
    };
    const handleContextMenu = (
        event: CustomEvent<{ eventData: SlickEventData; args: OnContextMenuArgs }>,
    ) => {
        const { eventData, args } = event.detail;
        if (args.row < 0 || args.cell < 0) {
            return;
        }
        eventData.preventDefault();
        openMenu(args.grid, args.row, args.cell, pointerTarget(eventData));
    };
    const closeMenu = () => {
        setMenu(undefined);
        reactGrid.current?.slickGrid?.focus();
    };

    const gridKey = `${isDark}:${definitions.map((column) => column.id).join()}`;
    const handleCreated = useCallback((event: CustomEvent) => {
        reactGrid.current = event.detail as SlickgridReactInstance;
        setViewport(reactGrid.current.slickGrid?.getViewportNode());
    }, []);
    // A column that grows keeps the width that the user gives it, as the least it takes.
    const handleColumnsResized = useCallback(
        (event: CustomEvent<{ args: { triggeredByColumn?: string } }>) => {
            const columnId = event.detail.args.triggeredByColumn;
            const column = reactGrid.current?.slickGrid
                ?.getColumns()
                .find((candidate) => String(candidate.id) === columnId);
            if (column && columnId && growFloors.current.has(columnId)) {
                growFloors.current.set(columnId, column.width ?? 0);
            }
            fillWidth();
        },
        [fillWidth],
    );
    // The grid creates its element with the grid role; the label goes on that element.
    useEffect(() => {
        reactGrid.current?.slickGrid?.getContainerNode().setAttribute("aria-label", ariaLabel);
    }, [ariaLabel, gridKey]);

    // On a short page, the slot keeps room for the visible rows, and the page scrolls.
    const minHeight = chromeHeight + Math.max(1, Math.min(items.length, visibleRows)) * rowHeight;
    const extraItems = menu && menuItems?.(menu.item);

    return (
        <div
            id={containerId}
            className={mergeClasses(
                "performance-grid",
                classes.slot,
                framed && classes.framed,
                fadeIn,
            )}
            style={{ minHeight }}>
            <FluentSlickGrid
                // The theme and a new set of columns take a new grid, from the default sort.
                key={gridKey}
                gridId={gridId}
                columns={definitions}
                options={options}
                dataset={dataset}
                onReactGridCreated={handleCreated}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
                onColumnsResized={handleColumnsResized}
            />
            {menu && (
                <Menu
                    open
                    positioning={{
                        target: menu.target,
                        position: "below",
                        align: menu.target instanceof HTMLElement ? "end" : "start",
                    }}
                    onOpenChange={(_event, data) => !data.open && closeMenu()}>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem icon={<Copy16Regular />} onClick={copySelection}>
                                {loc.slickGrid.copy}
                            </MenuItem>
                            {extraItems && (
                                <>
                                    <MenuDivider />
                                    {extraItems}
                                </>
                            )}
                        </MenuList>
                    </MenuPopover>
                </Menu>
            )}
        </div>
    );
}

/** Sorts values of one kind: numbers, text, or flags, with a missing value lowest. */
const compareSortValues: SortComparer = (
    left: DashboardGridSortValue,
    right: DashboardGridSortValue,
    direction = SortDirectionNumber.asc,
) => {
    if (left === right) {
        return 0;
    }
    if (left === undefined || right === undefined) {
        return direction * (left === undefined ? -1 : 1);
    }
    const order =
        typeof left === "string" && typeof right === "string"
            ? left.localeCompare(right)
            : Number(left) - Number(right);
    return direction * order;
};

/** A cell's content: its own drawing, or its text, with its tooltip. */
function drawCell<T>(
    columns: readonly DashboardGridColumn<T>[],
    columnId: string,
    item: T,
): HTMLElement | string {
    const column = columns.find((candidate) => candidate.id === columnId);
    if (!column) {
        return "";
    }
    const content = column.render?.(item) ?? textSpan(column.text(item));
    const title = column.title?.(item);
    if (title && !content.title) {
        content.title = title;
    }
    return content;
}

/** A point at the pointer, for a menu opened with a right click. */
function pointerTarget(event: SlickEventData): PositioningVirtualElement {
    const x = event.clientX ?? 0;
    const y = event.clientY ?? 0;
    return {
        getBoundingClientRect: () =>
            ({ x, y, top: y, left: x, bottom: y, right: x, width: 0, height: 0 }) as DOMRect,
    };
}

/*
 * The helpers below draw cell content. The grid draws its cells outside React, so cells are DOM;
 * the text is set as text, never parsed as HTML.
 */

/** Text that ends with an ellipsis when the cell is too narrow. */
export function textSpan(text: string, className?: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = mergeClassNames("performance-grid-text", className);
    span.textContent = text;
    return span;
}

/** An icon of a 16px or 12px Fluent icon path. */
export function gridIcon(path: string, size: 12 | 16 = 16): SVGSVGElement {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    const iconPath = document.createElementNS(svgNamespace, "path");
    iconPath.setAttribute("d", path);
    svg.append(iconPath);
    return svg;
}

/** A button with an icon. The grid runs the column's activate from it. */
export function iconButton(path: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "performance-grid-button";
    button.tabIndex = -1;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(gridIcon(path));
    return button;
}

/** A link, with an optional icon after its text. The grid runs the column's activate from it. */
export function linkCell(text: string, href: string, iconPath?: string): HTMLAnchorElement {
    const link = document.createElement("a");
    link.className = "performance-grid-link";
    link.href = href;
    link.tabIndex = -1;
    link.textContent = text;
    if (iconPath) {
        link.append(gridIcon(iconPath, 12));
    }
    return link;
}

/** A check box. The grid runs the column's activate from it. */
export function checkboxCell(checked: boolean, label: string): HTMLSpanElement {
    const box = document.createElement("span");
    box.className = "performance-grid-checkbox";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(checked));
    box.setAttribute("aria-label", label);
    box.title = label;
    if (checked) {
        box.append(gridIcon(checkmarkIconPath, 12));
    }
    return box;
}

/** A square of a color before the content, such as the color of a plan in the charts. */
export function withSwatch(color: string, content: HTMLElement | string): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "performance-grid-swatched";
    const swatch = document.createElement("span");
    swatch.className = "performance-grid-swatch";
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    span.append(swatch, content);
    return span;
}

function mergeClassNames(...names: (string | undefined)[]): string {
    return names.filter(Boolean).join(" ");
}
