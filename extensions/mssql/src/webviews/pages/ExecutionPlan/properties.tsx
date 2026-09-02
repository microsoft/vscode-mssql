/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../../../sharedInterfaces/executionPlan";

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
} from "@fluentui/react-components";
import {
    ArrowSortDownLines16Regular,
    ChevronDown16Regular,
    ChevronRight16Regular,
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

const useStyles = makeStyles({
    paneContainer: {
        height: "100%",
        width: "100%",
        overflowX: "hidden",
        overflowY: "scroll",
    },
    button: {
        cursor: "pointer",
    },
    previewToolbarIcon: {
        display: "block",
        width: "16px",
        height: "16px",
        flexShrink: 0,
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
    previewDismissButton: {
        width: "24px",
        minWidth: "24px",
        height: "24px",
        padding: 0,
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
}

export const PropertiesPane: React.FC<PropertiesPaneProps> = ({
    executionPlanView,
    setPropertiesClicked,
    inputRef,
}) => {
    const classes = useStyles();
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
    });

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
        if (event.target !== event.currentTarget) {
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
            let filteredItems = currentItems.filter(
                (item) => item.name.includes(searchValue) || item.value.includes(searchValue),
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
            renderHeaderCell: () => (
                <span className={classes.previewHeaderText} title={NAME}>
                    {NAME}
                </span>
            ),
            renderCell: (item) => {
                const isExpanded = openedButtons.includes(item.name);
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
            },
        }),
        createTableColumn<ep.ExecutionPlanPropertyTableItem>({
            columnId: "value",
            renderHeaderCell: () => (
                <span className={classes.previewHeaderText} title={VALUE}>
                    {VALUE}
                </span>
            ),
            renderCell: (item) => (
                <TableCellLayout
                    truncate
                    className={classes.previewCellLayout}
                    title={item.value || undefined}>
                    <span className={classes.previewCellText}>{item.value}</span>
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
                background: "var(--vscode-editor-background)",
                borderLeft:
                    "1px solid var(--vscode-sideBar-border, var(--vscode-editorGroup-border, transparent))",
            }}>
            <div className={classes.previewStickyHeader}>
                <div className={classes.previewPropertiesHeader}>
                    <div className={classes.previewHeaderTitle} aria-label={PROPERTIES}>
                        {PROPERTIES}
                    </div>
                    <div>
                        <Button
                            className={classes.previewDismissButton}
                            appearance="subtle"
                            size="small"
                            onClick={() => setPropertiesClicked(false)}
                            title={locConstants.common.close}
                            aria-label={locConstants.common.close}
                            icon={<Dismiss16Regular />}
                            ref={inputRef}
                        />
                    </div>
                </div>
                <div className={classes.previewNameContainer} aria-label={name} title={name}>
                    {name}
                </div>
                <Toolbar
                    className={mergeClasses(classes.toolbar, classes.previewToolbar)}
                    size="small">
                    <ToolbarButton
                        className={classes.button}
                        icon={
                            <ArrowSortDownLines16Regular className={classes.previewToolbarIcon} />
                        }
                        onClick={() => handleSort(ep.SortOption.Importance)}
                        title={IMPORTANCE}
                        aria-label={IMPORTANCE}
                    />
                    <ToolbarButton
                        className={classes.button}
                        icon={<TextSortAscending16Regular className={classes.previewToolbarIcon} />}
                        onClick={() => handleSort(ep.SortOption.Alphabetical)}
                        title={ALPHABETICAL}
                        aria-label={ALPHABETICAL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        icon={
                            <TextSortDescending16Regular className={classes.previewToolbarIcon} />
                        }
                        onClick={() => handleSort(ep.SortOption.ReverseAlphabetical)}
                        title={REVERSE_ALPHABETICAL}
                        aria-label={REVERSE_ALPHABETICAL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        icon={<ExpandAllIcon16Regular className={classes.previewToolbarIcon} />}
                        onClick={handleExpandAll}
                        title={EXPAND_ALL}
                        aria-label={EXPAND_ALL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        icon={<CollapseAllIcon16Regular className={classes.previewToolbarIcon} />}
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
                            <FilterIcon16Regular className={classes.previewToolbarIcon} />
                        }
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            void handleFilter(e.target.value);
                        }}
                    />
                </Toolbar>
            </div>
            <div className={classes.previewGridContainer}>
                <DataGrid
                    className={classes.previewGrid}
                    items={visibleItems}
                    columns={columns}
                    focusMode="composite"
                    resizableColumns={true}
                    columnSizingOptions={previewColumnSizingOptions}
                    size="small"
                    role="treegrid"
                    aria-label={`${PROPERTIES}: ${name}`}>
                    <DataGridHeader className={classes.previewTableHeader}>
                        <DataGridRow className={classes.previewHeaderRow}>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell className={classes.previewHeaderCell}>
                                    {renderHeaderCell()}
                                </DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<ep.ExecutionPlanPropertyTableItem>>
                        {({ item, rowId }) => (
                            <DataGridRow<ep.ExecutionPlanPropertyTableItem>
                                key={rowId}
                                data-property-id={item.id}
                                aria-level={item.level + 1}
                                aria-expanded={
                                    item.children.length > 0
                                        ? shownChildren.includes(item.children[0])
                                        : undefined
                                }
                                onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) =>
                                    handlePropertyRowKeyDown(event, item)
                                }
                                className={mergeClasses(
                                    classes.previewTableRow,
                                    item.children.length > 0 && classes.previewGroupRow,
                                )}>
                                {({ renderCell }) => (
                                    <DataGridCell className={classes.previewTableCell}>
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
