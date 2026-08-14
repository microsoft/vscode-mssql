/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlan.css";

import * as ep from "../../../sharedInterfaces/executionPlan";
import * as utils from "./queryPlanSetup";

import {
    Button,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
    Input,
    TableCellLayout,
    TableColumnDefinition,
    TableColumnSizingOptions,
    Toolbar,
    ToolbarButton,
    createTableColumn,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowSortDownLines16Regular,
    ChevronDown16Regular,
    ChevronDown20Regular,
    ChevronRight16Regular,
    ChevronRight20Regular,
    Dismiss12Regular,
    Dismiss16Regular,
    TextSortAscending16Regular,
    TextSortDescending16Regular,
} from "@fluentui/react-icons";
import { KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { ExecutionPlanGraphController } from "./executionPlanGraphController";
import { locConstants } from "../../common/locConstants";
import {
    CollapseAllIcon16Regular,
    ExpandAllIcon16Regular,
    FilterIcon16Regular,
} from "../../common/icons/executionPlanIcons";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

const useStyles = makeStyles({
    paneContainer: {
        height: "100%",
        width: "100%",
        overflowX: "hidden",
        overflowY: "scroll",
    },
    chevronButton: {
        padding: 0,
        height: "auto",
        minWidth: "auto",
        border: "none",
        backgroundColor: "transparent",
        boxShadow: "none",
    },
    button: {
        cursor: "pointer",
    },
    buttonImg: {
        display: "block",
        height: "16px",
        width: "16px",
    },
    previewToolbarIcon: {
        display: "block",
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    propertiesHeader: {
        fontWeight: "bold",
        fontSize: "12px",
        width: "100%",
        padding: "4px",
        opacity: 1,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
    },
    previewStickyHeader: {
        position: "sticky",
        top: 0,
        zIndex: 3,
        backgroundColor: "var(--vscode-editor-background)",
    },
    previewPropertiesHeader: {
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        height: "32px",
        padding: "0 6px 0 10px",
        borderBottom:
            "1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent))",
    },
    previewHeaderTitle: {
        minWidth: 0,
        overflow: "hidden",
        fontSize: "13px",
        fontWeight: 600,
        lineHeight: "20px",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    nameContainer: {
        fontWeight: "bold",
        fontSize: "14px",
        width: "100%",
        padding: "4px",
        opacity: 1,
    },
    previewNameContainer: {
        boxSizing: "border-box",
        width: "100%",
        height: "28px",
        padding: "0 10px",
        overflow: "hidden",
        color: "var(--vscode-descriptionForeground)",
        fontFamily: "var(--vscode-editor-font-family, Monaco, Menlo, Consolas, monospace)",
        fontSize: "12px",
        fontWeight: 600,
        lineHeight: "28px",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    tableHeader: {
        fontWeight: "bold",
        fontSize: "12px",
        border: "1px solid var(--vscode-foreground)",
    },
    tableRow: {
        height: "25px",
        overflow: "hidden",
    },
    tableCell: {
        overflow: "hidden",
        border: "1px solid var(--vscode-foreground)",
        fontSize: "12px",
    },
    previewGridContainer: {
        width: "100%",
        backgroundColor: "var(--vscode-editor-background)",
    },
    previewGrid: {
        width: "100%",
        color: "var(--vscode-editor-foreground)",
        fontFamily: "var(--vscode-font-family)",
        fontSize: "12px",
    },
    previewTableHeader: {
        position: "sticky",
        top: "92px",
        zIndex: 2,
        width: "100%",
        height: "28px",
        overflow: "hidden",
        borderBottom:
            "1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent))",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground))",
        fontSize: "12px",
        fontWeight: 600,
    },
    previewHeaderRow: {
        width: "100%",
        minHeight: "28px",
        height: "28px",
        overflow: "hidden",
    },
    previewHeaderCell: {
        boxSizing: "border-box",
        minWidth: 0,
        height: "28px",
        minHeight: "28px",
        padding: "0 8px",
        overflow: "hidden",
        border: "none",
        backgroundColor: "var(--vscode-editor-background)",
        "&:first-child": {
            borderRight:
                "1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent))",
        },
    },
    previewHeaderText: {
        display: "block",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    previewTableRow: {
        minHeight: "26px",
        height: "26px",
        overflow: "hidden",
        borderBottom:
            "1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent))",
        backgroundColor: "transparent",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "&:focus-within": {
            boxShadow: "inset 0 0 0 1px var(--vscode-focusBorder)",
        },
    },
    previewGroupRow: {
        backgroundColor:
            "var(--vscode-sideBarSectionHeader-background, var(--vscode-list-inactiveSelectionBackground))",
        fontWeight: 600,
    },
    previewTableCell: {
        boxSizing: "border-box",
        height: "26px",
        minHeight: "26px",
        padding: "0 8px",
        overflow: "hidden",
        border: "none",
        fontSize: "12px",
        "&:first-child": {
            borderRight:
                "1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent))",
        },
        "&:nth-child(2)": {
            fontFamily: "var(--vscode-editor-font-family, Monaco, Menlo, Consolas, monospace)",
        },
    },
    previewCellLayout: {
        width: "100%",
        minWidth: 0,
        padding: 0,
        overflow: "hidden",
    },
    previewNameContent: {
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
    },
    previewCellText: {
        display: "block",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    previewNameText: {
        flex: "1 1 0%",
        width: "auto",
    },
    previewDisclosureButton: {
        width: "16px",
        minWidth: "16px",
        height: "16px",
        minHeight: "16px",
        marginRight: "4px",
        padding: 0,
        border: "none",
        backgroundColor: "transparent",
        color: "inherit",
        boxShadow: "none",
    },
    previewDisclosureSpacer: {
        display: "block",
        width: "20px",
        minWidth: "20px",
        height: "16px",
    },
    inputbox: {
        width: "100%",
        minWidth: "50px",
        fontSize: "12px",
    },
    toolbar: {
        display: "flex",
        alignItems: "center",
    },
    previewToolbar: {
        boxSizing: "border-box",
        height: "32px",
        minHeight: "32px",
        padding: "0 4px",
        borderBottom:
            "1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent))",
    },
    dismissButton: {
        width: "12px",
        height: "12px",
        border: "none",
        outline: "none",
        marginRight: "4px",
    },
    previewDismissButton: {
        width: "24px",
        minWidth: "24px",
        height: "24px",
        padding: 0,
    },
    textContainer: {
        whiteSpace: "nowrap",
    },
});

const previewColumnSizingOptions: TableColumnSizingOptions = {
    name: {
        minWidth: 140,
        defaultWidth: 170,
        idealWidth: 180,
    },
    value: {
        minWidth: 140,
        defaultWidth: 220,
        idealWidth: 240,
    },
};

interface PropertiesPaneProps {
    executionPlanView: ExecutionPlanGraphController;
    setPropertiesClicked: any;
    inputRef: any;
    active?: boolean;
    useReactFlow: boolean;
}

export const PropertiesPane: React.FC<PropertiesPaneProps> = ({
    executionPlanView,
    setPropertiesClicked,
    inputRef,
    active = true,
    useReactFlow,
}) => {
    const { themeKind } = useVscodeWebview();
    const classes = useStyles();
    const theme = themeKind;
    const [shownChildren, setShownChildren] = useState<number[]>([]);
    const [openedButtons, setOpenedButtons] = useState<string[]>([]);
    const [name, setName] = useState<string>("");
    const [id, setId] = useState<string>("");
    const [items, setItems] = useState<ep.ExecutionPlanPropertyTableItem[]>([]);
    const [isFiltered, setIsFiltered] = useState<boolean>(false);
    const [unfilteredItems, setUnfilteredItems] = useState<ep.ExecutionPlanPropertyTableItem[]>([]);
    const [numItems, setNumItems] = useState<number>(0);
    const [inputValue, setInputValue] = useState<string>("");
    const propertiesPanelRef = useRef<HTMLDivElement>(null);

    const visibleItems = useMemo(() => {
        const itemsById = new Map(items.map((item) => [item.id, item]));
        const visibleChildIds = new Set(shownChildren);

        return items.filter((item) => {
            let currentItem = item;
            while (currentItem.isChild) {
                if (!visibleChildIds.has(currentItem.id)) {
                    return false;
                }
                const parentItem = itemsById.get(currentItem.parent);
                if (!parentItem) {
                    return false;
                }
                currentItem = parentItem;
            }
            return true;
        });
    }, [items, shownChildren]);

    const PROPERTIES = locConstants.executionPlan.properties;
    const NAME = locConstants.executionPlan.name;
    const VALUE = locConstants.executionPlan.value;
    const IMPORTANCE = locConstants.executionPlan.importance;
    const ALPHABETICAL = locConstants.executionPlan.alphabetical;
    const REVERSE_ALPHABETICAL = locConstants.executionPlan.reverseAlphabetical;
    const EXPAND_ALL = locConstants.executionPlan.expandAll;
    const COLLAPSE_ALL = locConstants.executionPlan.collapseAll;
    const FILTER_ANY_FIELD = locConstants.executionPlan.filterAnyField;

    // this sets the items list on the initial load, so there isn't a delay
    useEffect(() => {
        // check whether items is actively filtered so it doesn't rerender if there
        // are no filter results
        if (!items.length && !isFiltered) {
            const selectedElement = executionPlanView.getSelectedElement();
            const element: ep.ExecutionPlanNode =
                selectedElement && "name" in selectedElement
                    ? selectedElement
                    : executionPlanView.getRoot();
            loadItems(element);
        }
    }, [items, isFiltered]);

    useEffect(() => {
        if (!active) {
            return;
        }
        // poll for whether there has been a new element selected in the graph
        const intervalId = setInterval(() => {
            const selectedElement = executionPlanView.getSelectedElement();
            const element: ep.ExecutionPlanNode =
                selectedElement && "name" in selectedElement
                    ? selectedElement
                    : executionPlanView.getRoot();

            // Check if the element has changed, if so, reload items based on new element
            if (element.id !== id) {
                loadItems(element);
            }
        }, 1000);

        return () => clearInterval(intervalId);
    }, [active, executionPlanView, id]);

    function loadItems(element: ep.ExecutionPlanNode) {
        setName(element.name);
        setId(element.id);

        // make items list, and sort it based on importance
        const unsortedItems = buildItemListFromProperties(element.properties, 0, 0, false, -1);
        setItems(
            recursiveSort(
                unsortedItems,
                unsortedItems.filter((item) => !item.isChild),
                ep.SortOption.Importance,
            ),
        );
        setNumItems(unsortedItems.length);
    }

    const handleShowChildrenClick = async (buttonName: string, children: number[]) => {
        if (shownChildren.includes(children[0])) {
            // If the first child is in shownChildren, this means it is collapsing,
            // so remove all children passed in and change the button icon
            setShownChildren((prevShownChildren) =>
                prevShownChildren.filter((child) => !children.includes(child)),
            );
            setOpenedButtons(openedButtons.filter((button) => button !== buttonName));
        } else {
            // Otherwise, it is expanding, so add all children, and change button icon
            setShownChildren((prevShownChildren) => [...prevShownChildren, ...children]);
            setOpenedButtons([...openedButtons, buttonName]);
        }
    };

    const handlePropertyRowKeyDown = (
        event: ReactKeyboardEvent<HTMLDivElement>,
        item: ep.ExecutionPlanPropertyTableItem,
    ) => {
        if (!useReactFlow || event.target !== event.currentTarget) {
            return;
        }

        const isExpanded = item.children.length > 0 && shownChildren.includes(item.children[0]);
        if (event.key === "ArrowRight" && item.children.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            if (isExpanded) {
                focusPropertyRow(item.children[0]);
            } else {
                void handleShowChildrenClick(item.name, item.children);
            }
        } else if (event.key === "ArrowLeft") {
            if (isExpanded) {
                event.preventDefault();
                event.stopPropagation();
                void handleShowChildrenClick(item.name, item.children);
            } else if (item.parent >= 0) {
                event.preventDefault();
                event.stopPropagation();
                focusPropertyRow(item.parent);
            }
        }
    };

    const focusPropertyRow = (itemId: number) => {
        propertiesPanelRef.current
            ?.querySelector<HTMLElement>(`[role="row"][data-property-id="${itemId}"]`)
            ?.focus();
    };

    // ads removes filters before carrying out any of the toolbar actions
    const handleSort = async (sortOption: ep.SortOption) => {
        const currentItems = resetFiltering();
        setItems(
            recursiveSort(
                currentItems,
                currentItems.filter((item) => !item.isChild),
                sortOption,
            ),
        );
    };

    const handleExpandAll = async () => {
        const currentItems = resetFiltering();
        setOpenedButtons(currentItems.map((item) => item.name));
        setShownChildren(currentItems.map((item) => item.id));
    };

    const handleCollapseAll = async () => {
        resetFiltering();
        setOpenedButtons([]);
        setShownChildren([]);
    };

    const handleFilter = async (searchValue: string) => {
        // on starting filtering, save the current items so that when filtering stops
        // it can properly reset the items
        let firstFilter = false;
        if (items.length === numItems) {
            setUnfilteredItems(items);
            firstFilter = true;
        }

        if (searchValue !== "") {
            // react updates state asynchronously, so if the state of unfiltered
            // items hasn't been updated yet, ie. on the first filter, use items instead
            const currentItems = firstFilter ? items : unfilteredItems;
            // Case-insensitive: "Actual" and "actual" must match the same rows.
            const needle = searchValue.toLowerCase();
            let filteredItems = currentItems.filter(
                (item) =>
                    item.name.toLowerCase().includes(needle) ||
                    item.value.toLowerCase().includes(needle),
            );

            setItems(buildFilteredItemsFromChildList(filteredItems, currentItems));
            setIsFiltered(true);
        }
        // filtering is removed
        else {
            resetFiltering();
        }
    };

    function resetFiltering(): ep.ExecutionPlanPropertyTableItem[] {
        // react updates state asynchronously, so if the state of unfiltered
        // items hasn't been updated yet, ie. sorting while actively filtering,
        // use unfiltered items instead
        const currentItems = isFiltered ? unfilteredItems : items;
        setItems(unfilteredItems);
        setIsFiltered(false);
        setInputValue("");
        return currentItems;
    }

    const columns: TableColumnDefinition<ep.ExecutionPlanPropertyTableItem>[] = [
        createTableColumn<ep.ExecutionPlanPropertyTableItem>({
            columnId: "name",
            renderHeaderCell: () =>
                useReactFlow ? (
                    <span className={classes.previewHeaderText} title={NAME}>
                        {NAME}
                    </span>
                ) : (
                    NAME
                ),
            renderCell: (item) => {
                const isExpanded = openedButtons.includes(item.name);
                if (useReactFlow) {
                    return (
                        <TableCellLayout
                            truncate
                            className={classes.previewCellLayout}
                            title={item.name || undefined}>
                            <div
                                className={classes.previewNameContent}
                                style={{ paddingLeft: `${item.level * 16}px` }}>
                                {item.children.length > 0 ? (
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        className={classes.previewDisclosureButton}
                                        aria-label={
                                            isExpanded
                                                ? locConstants.executionPlan.collapse
                                                : locConstants.executionPlan.expand
                                        }
                                        aria-expanded={isExpanded}
                                        icon={
                                            isExpanded ? (
                                                <ChevronDown16Regular />
                                            ) : (
                                                <ChevronRight16Regular />
                                            )
                                        }
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void handleShowChildrenClick(item.name, item.children);
                                        }}
                                    />
                                ) : (
                                    item.level > 0 && (
                                        <span
                                            className={classes.previewDisclosureSpacer}
                                            aria-hidden="true"
                                        />
                                    )
                                )}
                                <span
                                    className={mergeClasses(
                                        classes.previewCellText,
                                        classes.previewNameText,
                                    )}>
                                    {item.name}
                                </span>
                            </div>
                        </TableCellLayout>
                    );
                }

                return (
                    // Add tabbing based on the "level" of the item in the table,
                    // and add expand button based on whether the item has children
                    <TableCellLayout truncate className={classes.textContainer}>
                        {`\u200b\t`.repeat(item.level * 6)}
                        {item.children.length > 0 && (
                            <Button
                                size="small"
                                className={classes.chevronButton}
                                aria-label={
                                    isExpanded
                                        ? locConstants.executionPlan.collapse
                                        : locConstants.executionPlan.expand
                                }
                                icon={
                                    isExpanded ? (
                                        <ChevronDown20Regular />
                                    ) : (
                                        <ChevronRight20Regular />
                                    )
                                }
                                onClick={() => handleShowChildrenClick(item.name, item.children)}
                            />
                        )}
                        {item.name}
                    </TableCellLayout>
                );
            },
        }),
        createTableColumn<ep.ExecutionPlanPropertyTableItem>({
            columnId: "value",
            renderHeaderCell: () =>
                useReactFlow ? (
                    <span className={classes.previewHeaderText} title={VALUE}>
                        {VALUE}
                    </span>
                ) : (
                    VALUE
                ),
            renderCell: (item) =>
                useReactFlow ? (
                    <TableCellLayout
                        truncate
                        className={classes.previewCellLayout}
                        title={item.value || undefined}>
                        <span className={classes.previewCellText}>{item.value}</span>
                    </TableCellLayout>
                ) : (
                    <TableCellLayout truncate className={classes.textContainer}>
                        {item.value}
                    </TableCellLayout>
                ),
        }),
    ];

    return (
        <div
            ref={propertiesPanelRef}
            id="propertiesPanelContainer"
            className={classes.paneContainer}
            style={{
                background: useReactFlow
                    ? "var(--vscode-editor-background)"
                    : tokens.colorNeutralBackground2,
                borderLeft: useReactFlow
                    ? "1px solid var(--vscode-sideBar-border, var(--vscode-editorGroup-border, transparent))"
                    : `0.5px solid ${tokens.colorNeutralStroke1}`,
            }}>
            <div
                className={useReactFlow ? classes.previewStickyHeader : undefined}
                style={
                    useReactFlow
                        ? undefined
                        : {
                              position: "sticky",
                              top: 0,
                              zIndex: 1,
                              background: tokens.colorNeutralBackground1,
                          }
                }>
                <div
                    className={
                        useReactFlow ? classes.previewPropertiesHeader : classes.propertiesHeader
                    }
                    style={
                        useReactFlow
                            ? undefined
                            : {
                                  background: tokens.colorNeutralBackground2,
                              }
                    }>
                    <div
                        className={useReactFlow ? classes.previewHeaderTitle : undefined}
                        aria-label={PROPERTIES}
                        tabIndex={useReactFlow ? undefined : 0}>
                        {PROPERTIES}
                    </div>
                    <div tabIndex={useReactFlow ? undefined : 0}>
                        <Button
                            className={
                                useReactFlow ? classes.previewDismissButton : classes.dismissButton
                            }
                            appearance={useReactFlow ? "subtle" : undefined}
                            size={useReactFlow ? "small" : undefined}
                            style={
                                useReactFlow
                                    ? undefined
                                    : {
                                          background: tokens.colorNeutralBackground2,
                                      }
                            }
                            onClick={() => setPropertiesClicked(false)}
                            title={locConstants.common.close}
                            aria-label={locConstants.common.close}
                            icon={useReactFlow ? <Dismiss16Regular /> : <Dismiss12Regular />}
                            ref={inputRef}
                        />
                    </div>
                </div>
                <div
                    className={useReactFlow ? classes.previewNameContainer : classes.nameContainer}
                    aria-label={name}
                    title={useReactFlow ? name : undefined}
                    tabIndex={useReactFlow ? undefined : 0}>
                    {name}
                </div>
                <Toolbar
                    className={
                        useReactFlow
                            ? mergeClasses(classes.toolbar, classes.previewToolbar)
                            : classes.toolbar
                    }
                    size="small">
                    <ToolbarButton
                        className={classes.button}
                        icon={
                            useReactFlow ? (
                                <ArrowSortDownLines16Regular
                                    className={classes.previewToolbarIcon}
                                />
                            ) : (
                                <img
                                    className={classes.buttonImg}
                                    src={utils.sortByImportance(theme)}
                                    alt={IMPORTANCE}
                                />
                            )
                        }
                        onClick={() => handleSort(ep.SortOption.Importance)}
                        title={IMPORTANCE}
                        aria-label={IMPORTANCE}
                    />
                    <ToolbarButton
                        className={classes.button}
                        icon={
                            useReactFlow ? (
                                <TextSortAscending16Regular
                                    className={classes.previewToolbarIcon}
                                />
                            ) : (
                                <img
                                    className={classes.buttonImg}
                                    src={utils.sortAlphabetically(theme)}
                                    alt={ALPHABETICAL}
                                />
                            )
                        }
                        onClick={() => handleSort(ep.SortOption.Alphabetical)}
                        title={ALPHABETICAL}
                        aria-label={ALPHABETICAL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        icon={
                            useReactFlow ? (
                                <TextSortDescending16Regular
                                    className={classes.previewToolbarIcon}
                                />
                            ) : (
                                <img
                                    className={classes.buttonImg}
                                    src={utils.sortReverseAlphabetically(theme)}
                                    alt={REVERSE_ALPHABETICAL}
                                />
                            )
                        }
                        onClick={() => handleSort(ep.SortOption.ReverseAlphabetical)}
                        title={REVERSE_ALPHABETICAL}
                        aria-label={REVERSE_ALPHABETICAL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        icon={
                            useReactFlow ? (
                                <ExpandAllIcon16Regular className={classes.previewToolbarIcon} />
                            ) : (
                                <img
                                    className={classes.buttonImg}
                                    src={utils.expandAll(theme)}
                                    alt={EXPAND_ALL}
                                />
                            )
                        }
                        onClick={handleExpandAll}
                        title={EXPAND_ALL}
                        aria-label={EXPAND_ALL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        icon={
                            useReactFlow ? (
                                <CollapseAllIcon16Regular className={classes.previewToolbarIcon} />
                            ) : (
                                <img
                                    className={classes.buttonImg}
                                    src={utils.collapseAll(theme)}
                                    alt={COLLAPSE_ALL}
                                />
                            )
                        }
                        onClick={handleCollapseAll}
                        title={COLLAPSE_ALL}
                        aria-label={COLLAPSE_ALL}
                    />
                    <Input
                        type="text"
                        size="small"
                        className={classes.inputbox}
                        value={inputValue}
                        placeholder={FILTER_ANY_FIELD}
                        contentBefore={
                            useReactFlow ? (
                                <FilterIcon16Regular className={classes.previewToolbarIcon} />
                            ) : (
                                <img
                                    src={utils.filterIcon(theme)}
                                    alt={FILTER_ANY_FIELD}
                                    style={{ width: "20px", height: "20px" }}
                                />
                            )
                        }
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            void handleFilter(e.target.value);
                        }}
                    />
                </Toolbar>
            </div>
            <div
                className={useReactFlow ? classes.previewGridContainer : undefined}
                style={useReactFlow ? undefined : { width: "100%" }}>
                <DataGrid
                    className={useReactFlow ? classes.previewGrid : undefined}
                    items={visibleItems}
                    columns={columns}
                    focusMode="composite"
                    resizableColumns={true}
                    columnSizingOptions={useReactFlow ? previewColumnSizingOptions : undefined}
                    size="small"
                    role={useReactFlow ? "treegrid" : "grid"}
                    aria-label={useReactFlow ? `${PROPERTIES}: ${name}` : undefined}>
                    <DataGridHeader
                        className={useReactFlow ? classes.previewTableHeader : classes.tableHeader}
                        style={
                            useReactFlow
                                ? undefined
                                : {
                                      background: tokens.colorNeutralBackground2,
                                  }
                        }>
                        <DataGridRow
                            className={useReactFlow ? classes.previewHeaderRow : classes.tableRow}>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell
                                    className={
                                        useReactFlow
                                            ? classes.previewHeaderCell
                                            : classes.tableHeader
                                    }>
                                    {renderHeaderCell()}
                                </DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<ep.ExecutionPlanPropertyTableItem>
                        tabIndex={useReactFlow ? undefined : 0}>
                        {({ item, rowId }) => (
                            <DataGridRow<ep.ExecutionPlanPropertyTableItem>
                                key={rowId}
                                data-property-id={item.id}
                                aria-level={useReactFlow ? item.level + 1 : undefined}
                                aria-expanded={
                                    useReactFlow && item.children.length > 0
                                        ? shownChildren.includes(item.children[0])
                                        : undefined
                                }
                                onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) =>
                                    handlePropertyRowKeyDown(event, item)
                                }
                                className={
                                    useReactFlow
                                        ? mergeClasses(
                                              classes.previewTableRow,
                                              item.children.length > 0 && classes.previewGroupRow,
                                          )
                                        : classes.tableRow
                                }>
                                {({ renderCell }) => (
                                    <DataGridCell
                                        className={
                                            useReactFlow
                                                ? classes.previewTableCell
                                                : classes.tableCell
                                        }>
                                        {renderCell(item)}
                                    </DataGridCell>
                                )}
                            </DataGridRow>
                        )}
                    </DataGridBody>
                </DataGrid>
            </div>
        </div>
    );
};

function buildItemListFromProperties(
    properties: ep.ExecutionPlanGraphElementProperty[] | null | undefined,
    currentLength: number,
    level: number,
    isChild: boolean,
    parent: number,
): ep.ExecutionPlanPropertyTableItem[] {
    if (!Array.isArray(properties)) {
        return [];
    }

    let items: ep.ExecutionPlanPropertyTableItem[] = [];
    for (const property of properties) {
        let children: number[] = [];
        let childrenItems: ep.ExecutionPlanPropertyTableItem[] = [];
        if (Array.isArray(property.value)) {
            childrenItems = buildItemListFromProperties(
                property.value,
                currentLength + 1,
                level + 1,
                true,
                currentLength,
            );

            children = childrenItems
                .map((item, index) => {
                    const id = currentLength + 1 + index;
                    item.id = id;
                    return { id, level: item.level };
                })
                .filter((child) => child.level === level + 1)
                .map((child) => child.id);
        }
        const item: ep.ExecutionPlanPropertyTableItem = {
            id: currentLength,
            name: property.name ?? "",
            value: property.displayValue ?? "",
            parent: parent,
            children: children,
            displayOrder: property.displayOrder,
            isExpanded: false,
            isChild: isChild,
            level: level,
        };
        items.push(item);
        items = items.concat(childrenItems);
        currentLength += childrenItems.length + 1;
    }
    return items;
}

function buildFilteredItemsFromChildList(
    childList: ep.ExecutionPlanPropertyTableItem[],
    itemList: ep.ExecutionPlanPropertyTableItem[],
): ep.ExecutionPlanPropertyTableItem[] {
    let fullItemList: ep.ExecutionPlanPropertyTableItem[] = [];

    for (const child of childList) {
        if (child.parent != -1) {
            const parent = itemList.find((item) => child.parent === item.id)!;
            if (parent && !fullItemList.some((fullItem) => fullItem.id === parent.id)) {
                const parentList = buildFilteredItemsFromChildList([parent], itemList).filter(
                    (parentItem) => !fullItemList.some((fullItem) => fullItem.id === parentItem.id),
                );

                fullItemList = fullItemList.concat(parentList);
            }
        }
        fullItemList.push(child);
    }

    return fullItemList;
}

function recursiveSort(
    items: ep.ExecutionPlanPropertyTableItem[],
    parentList: ep.ExecutionPlanPropertyTableItem[],
    sortOption: ep.SortOption,
): ep.ExecutionPlanPropertyTableItem[] {
    let sortedList: ep.ExecutionPlanPropertyTableItem[] = [];

    if (sortOption == ep.SortOption.Alphabetical) {
        parentList = parentList.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOption == ep.SortOption.ReverseAlphabetical) {
        parentList = parentList.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortOption == ep.SortOption.Importance) {
        parentList = parentList.sort((a, b) => a.displayOrder - b.displayOrder);
    }

    for (const item of parentList) {
        sortedList.push(item);
        let childList: ep.ExecutionPlanPropertyTableItem[] = [];

        for (const childId of item.children) {
            const childItem = items.find((childItem) => childItem.id === childId);
            if (childItem) {
                childList.push(childItem);
            }
        }

        sortedList = sortedList.concat(recursiveSort(items, childList, sortOption));
    }
    return sortedList;
}
