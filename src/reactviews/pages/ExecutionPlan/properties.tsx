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
    Toolbar,
    ToolbarButton,
    createTableColumn,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    ChevronDown20Regular,
    ChevronRight20Regular,
    Dismiss12Regular,
} from "@fluentui/react-icons";
import { useContext, useEffect, useState } from "react";

import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { ExecutionPlanView } from "./executionPlanView";
import { locConstants } from "../../common/locConstants";

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
    nameContainer: {
        fontWeight: "bold",
        fontSize: "14px",
        width: "100%",
        padding: "4px",
        opacity: 1,
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
    inputbox: {
        width: "100%",
        minWidth: "50px",
        fontSize: "12px",
    },
    toolbar: {
        display: "flex",
        alignItems: "center",
    },
    dismissButton: {
        width: "12px",
        height: "12px",
        border: "none",
        outline: "none",
        marginRight: "4px",
    },
    textContainer: {
        whiteSpace: "nowrap",
    },
});

interface PropertiesPaneProps {
    executionPlanView: ExecutionPlanView;
    setPropertiesClicked: any;
    inputRef: any;
}

export const PropertiesPane: React.FC<PropertiesPaneProps> = ({
    executionPlanView,
    setPropertiesClicked,
    inputRef,
}) => {
    const classes = useStyles();
    const context = useContext(ExecutionPlanContext);
    const theme = context!.themeKind;
    const [shownChildren, setShownChildren] = useState<number[]>([]);
    const [openedButtons, setOpenedButtons] = useState<string[]>([]);
    const [name, setName] = useState<string>("");
    const [id, setId] = useState<string>("");
    const [items, setItems] = useState<ep.ExecutionPlanPropertyTableItem[]>([]);
    const [isFiltered, setIsFiltered] = useState<boolean>(false);
    const [unfilteredItems, setUnfilteredItems] = useState<ep.ExecutionPlanPropertyTableItem[]>([]);
    const [numItems, setNumItems] = useState<number>(0);
    const [inputValue, setInputValue] = useState<string>("");

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
            renderHeaderCell: () => NAME,
            renderCell: (item) => (
                // Add tabbing based on the "level" of the item in the table,
                // and add expand button based on whether the item has children
                <TableCellLayout truncate className={classes.textContainer}>
                    {`\u200b\t`.repeat(item.level * 6)}
                    {item.children.length > 0 && (
                        <Button
                            size="small"
                            className={classes.chevronButton}
                            aria-label={
                                openedButtons.includes(item.name)
                                    ? locConstants.executionPlan.collapse
                                    : locConstants.executionPlan.expand
                            }
                            icon={
                                openedButtons.includes(item.name) ? (
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
            ),
        }),
        createTableColumn<ep.ExecutionPlanPropertyTableItem>({
            columnId: "value",
            renderHeaderCell: () => VALUE,
            renderCell: (item) => (
                <TableCellLayout truncate className={classes.textContainer}>
                    {item.value}
                </TableCellLayout>
            ),
        }),
    ];

    return (
        <div
            id="propertiesPanelContainer"
            className={classes.paneContainer}
            style={{
                background: tokens.colorNeutralBackground2,
                borderLeft: `0.5px solid ${tokens.colorNeutralStroke1}`,
            }}>
            <div
                style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    background: tokens.colorNeutralBackground1,
                }}>
                <div
                    className={classes.propertiesHeader}
                    style={{
                        background: tokens.colorNeutralBackground2,
                    }}>
                    <div aria-label={PROPERTIES} tabIndex={0}>
                        {PROPERTIES}
                    </div>
                    <div tabIndex={0}>
                        <Button
                            className={classes.dismissButton}
                            style={{
                                background: tokens.colorNeutralBackground2,
                            }}
                            onClick={() => setPropertiesClicked(false)}
                            title={locConstants.common.close}
                            aria-label={locConstants.common.close}
                            icon={<Dismiss12Regular />}
                            ref={inputRef}
                        />
                    </div>
                </div>
                <div className={classes.nameContainer} aria-label={name} tabIndex={0}>
                    {name}
                </div>
                <Toolbar className={classes.toolbar} size="small">
                    <ToolbarButton
                        className={classes.button}
                        tabIndex={0}
                        icon={
                            <img
                                className={classes.buttonImg}
                                src={utils.sortByImportance(theme)}
                                alt={IMPORTANCE}
                            />
                        }
                        onClick={() => handleSort(ep.SortOption.Importance)}
                        title={IMPORTANCE}
                        aria-label={IMPORTANCE}
                    />
                    <ToolbarButton
                        className={classes.button}
                        tabIndex={0}
                        icon={
                            <img
                                className={classes.buttonImg}
                                src={utils.sortAlphabetically(theme)}
                                alt={ALPHABETICAL}
                            />
                        }
                        onClick={() => handleSort(ep.SortOption.Alphabetical)}
                        title={ALPHABETICAL}
                        aria-label={ALPHABETICAL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        tabIndex={0}
                        icon={
                            <img
                                className={classes.buttonImg}
                                src={utils.sortReverseAlphabetically(theme)}
                                alt={REVERSE_ALPHABETICAL}
                            />
                        }
                        onClick={() => handleSort(ep.SortOption.ReverseAlphabetical)}
                        title={REVERSE_ALPHABETICAL}
                        aria-label={REVERSE_ALPHABETICAL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        tabIndex={0}
                        icon={
                            <img
                                className={classes.buttonImg}
                                src={utils.expandAll(theme)}
                                alt={EXPAND_ALL}
                            />
                        }
                        onClick={handleExpandAll}
                        title={EXPAND_ALL}
                        aria-label={EXPAND_ALL}
                    />
                    <ToolbarButton
                        className={classes.button}
                        tabIndex={0}
                        icon={
                            <img
                                className={classes.buttonImg}
                                src={utils.collapseAll(theme)}
                                alt={COLLAPSE_ALL}
                            />
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
                            <img
                                src={utils.filterIcon(theme)}
                                alt={FILTER_ANY_FIELD}
                                style={{ width: "20px", height: "20px" }}
                            />
                        }
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            void handleFilter(e.target.value);
                        }}
                    />
                </Toolbar>
            </div>
            <div style={{ width: "100%" }}>
                <DataGrid
                    items={items}
                    columns={columns}
                    focusMode="composite"
                    resizableColumns={true}
                    size="small">
                    <DataGridHeader
                        className={classes.tableHeader}
                        style={{
                            background: tokens.colorNeutralBackground2,
                        }}>
                        <DataGridRow className={classes.tableRow}>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell className={classes.tableHeader}>
                                    {renderHeaderCell()}
                                </DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<ep.ExecutionPlanPropertyTableItem> tabIndex={0}>
                        {({ item, rowId }) => (
                            <>
                                {(!item.isChild || shownChildren.includes(item.id)) && (
                                    <DataGridRow<ep.ExecutionPlanPropertyTableItem>
                                        key={rowId}
                                        className={classes.tableRow}>
                                        {({ renderCell }) => (
                                            <DataGridCell className={classes.tableCell}>
                                                {renderCell(item)}
                                            </DataGridCell>
                                        )}
                                    </DataGridRow>
                                )}
                            </>
                        )}
                    </DataGridBody>
                </DataGrid>
            </div>
        </div>
    );
};

function buildItemListFromProperties(
    properties: ep.ExecutionPlanGraphElementProperty[],
    currentLength: number,
    level: number,
    isChild: boolean,
    parent: number,
): ep.ExecutionPlanPropertyTableItem[] {
    let items: ep.ExecutionPlanPropertyTableItem[] = [];
    for (const property of properties) {
        let children: number[] = [];
        let childrenItems: ep.ExecutionPlanPropertyTableItem[] = [];
        if (typeof property.value !== "string") {
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
            name: property.name,
            value: property.displayValue,
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
