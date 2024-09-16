/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import * as utils from "./queryPlanSetup";
import {
  DataGrid,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  DataGridCell,
  makeStyles,
  DataGridBody,
  createTableColumn,
  TableCellLayout,
  TableColumnDefinition,
  Button,
  Toolbar,
  ToolbarButton,
  Input,
} from "@fluentui/react-components";
import { ChevronDown20Regular, ChevronRight20Regular } from '@fluentui/react-icons';
import * as ep from "./executionPlanInterfaces";
import "./executionPlan.css";

const useStyles = makeStyles({
  paneContainer: {
    position: "absolute",
    top: 0,
    right: "35px",
    opacity: 1,
    height: "100%",
    width: "500px",
	overflow: "auto"
  },
  chevronButton: {
    padding: 0,
    height: 'auto',
    minWidth: 'auto',
    border: 'none',
    backgroundColor: 'transparent',
    boxShadow: 'none',
  },
  button: {
		cursor: "pointer"
	},
	buttonImg: {
		display: "block",
		height: "16px",
		width: "16px"
	},
  propertiesHeader: {
    fontWeight: "bold",
    fontSize: "12px",
    width: "100%",
    opacity: 1
  },
  tableHeader: {
    fontWeight: "bold",
    border: "1px solid #bbbbbb",
  },
  tableRow: {
    height: "25px",
    overflow: "hidden"
  },
  tableCell: {
    overflow: "hidden",
    border: "1px solid #bbbbbb",
    fontSize: "12px",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis"
  },
	inputbox: {
		minWidth: "50px",
		width: "100px",
		maxWidth: "100px",
		overflow: "hidden",
    right: 0
	},
});

interface PropertiesPaneProps {
  executionPlanView: any;
}

export const PropertiesPane: React.FC<PropertiesPaneProps> = ({
  executionPlanView,
}) => {
  const classes = useStyles();
  const state = useContext(ExecutionPlanContext);
  const executionPlanState = state?.state;
  const [shownChildren, setShownChildren] = useState<number[]>([]);
  const [openedButtons, setOpenedButtons] = useState<string[]>([]);
  const [items, setItems] = useState<ep.ExecutionPlanPropertyTableItem[]>([]);
  const [isFiltered, setIsFiltered] = useState<boolean>(false);
  const [unfilteredItems, setUnfilteredItems] = useState<ep.ExecutionPlanPropertyTableItem[]>([]);
  const [numItems, setNumItems] = useState<number>(0);
  const [inputValue, setInputValue] = useState<string>("");

  const element: ep.ExecutionPlanNode =
    executionPlanView.getSelectedElement() ?? executionPlanView.getRoot();

  useEffect(() => {
    if (!items.length && !isFiltered) {
      const unsortedItems = mapPropertiesToItems(element.properties, 0, 0, false, -1);
      setItems(sort(unsortedItems, ep.SortOption.Importance));
      setNumItems(unsortedItems.length);
    }
	}, [items, isFiltered]);

  const handleShowChildrenClick = async (buttonName: string, children: number[]) => {
    if (shownChildren.includes(children[0])) {
      // If the first child is in shownChildren, remove all children
      setShownChildren((prevShownChildren) =>
        prevShownChildren.filter((child) => !children.includes(child))
      );
      setOpenedButtons(openedButtons.filter(button => button !== buttonName));
    } else {
      // Otherwise, add all children
      setShownChildren((prevShownChildren) => [
        ...prevShownChildren,
        ...children,
      ]);
      setOpenedButtons([...openedButtons, buttonName]);
    }
  };

  const handleSort = async (sortOption: ep.SortOption) => {
    const currentItems = resetFiltering();
    setItems(sort(currentItems, sortOption));
	};

  const handleExpandAll = async () => {
    const currentItems = resetFiltering();
    setOpenedButtons(currentItems.map(item => item.name));
    setShownChildren(currentItems.map(item => item.id));
	};

  const handleCollapseAll = async () => {
    resetFiltering();
    setOpenedButtons([]);
    setShownChildren([]);
	};

  const handleInputChange = async (currentInputValue: string) => {
    setInputValue(currentInputValue);
    handleFilter(currentInputValue);
	};

  const handleFilter = async (searchValue: string) => {
    let firstFilter = false;
    if (items.length === numItems) {
      setUnfilteredItems(items);
      firstFilter = true;
    }

    if(searchValue !== "") {
      // react updates state asynchronously, so if the state of unfiltered
      // items hasn't been updated yet, ie. on the first filter, use items instead
      const currentItems = firstFilter ? items : unfilteredItems;
      let filteredItems = currentItems.filter(item =>
        item.name.includes(searchValue) || item.value.includes(searchValue)
      );
      const temp = buildFilteredItemsFromChildList(filteredItems, currentItems);
      console.log(temp);
      setItems(temp);
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
    const currentItems = isFiltered ? unfilteredItems: items;
    setItems(unfilteredItems);
    setIsFiltered(false);
    setInputValue("");
    return currentItems;
  }

  // Define the columns
  const columns: TableColumnDefinition<ep.ExecutionPlanPropertyTableItem>[] = [
    // is there a way to put a button this is item.children.length > 0
      createTableColumn<ep.ExecutionPlanPropertyTableItem>({
        columnId: "name",
        renderHeaderCell: () => "Name",
        renderCell: (item) =>
        <TableCellLayout>
          <div style={{textOverflow: "ellipsis", whiteSpace: "nowrap"}}>
            {item.children.length > 0 && (
              <Button
                size="small"
                className={classes.chevronButton}
                icon={openedButtons.includes(item.name) ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                onClick={() => handleShowChildrenClick(item.name, item.children)}
              />
            )}
            {item.name}
          </div>
        </TableCellLayout>,
      }),
      createTableColumn<ep.ExecutionPlanPropertyTableItem>({
        columnId: "value",
        renderHeaderCell: () => "Value",
        renderCell: (item) => <TableCellLayout><div className="text" style={{textOverflow: "ellipsis"}}>{item.value}</div></TableCellLayout>,
      }),
    ];

  return (
    <div
      id="propertiesPanelContainer"
      className={classes.paneContainer}
      style={{ background: utils.background(executionPlanState!.theme!) }}
    >
	    <div className={classes.propertiesHeader} style={{background:utils.background(executionPlanState!.theme!)}}>
        Properties
      </div>
      <br/>
      {element.name}
      <Toolbar>
        <ToolbarButton
          className={classes.button}
          tabIndex={0}
          icon={
            <img
            className={classes.buttonImg}
            src={utils.sortByImportance(executionPlanState!.theme!)}
            alt={"Sort by importance"}
            />
          }
          onClick={() => handleSort(ep.SortOption.Importance)}
          title={"Importance"}
          aria-label={"Sort By Importance"}
        />
        <ToolbarButton
          className={classes.button}
          tabIndex={0}
          icon={
            <img
            className={classes.buttonImg}
            src={utils.sortAlphabetically(executionPlanState!.theme!)}
            alt={"Sort alphabetically"}
            />
          }
          onClick={() => handleSort(ep.SortOption.Alphabetical)}
          title={"Alphabetical"}
          aria-label={"Sort alphabetically"}
        />
        <ToolbarButton
          className={classes.button}
          tabIndex={0}
          icon={
            <img
            className={classes.buttonImg}
            src={utils.sortReverseAlphabetically(executionPlanState!.theme!)}
            alt={"Sort reverse alphabetically"}
            />
          }
          onClick={() => handleSort(ep.SortOption.ReverseAlphabetical)}
          title={"Reverse Alphabetical"}
          aria-label={"Sort reverse alphabetically"}
        />
        <ToolbarButton
          className={classes.button}
          tabIndex={0}
          icon={
            <img
            className={classes.buttonImg}
            src={utils.expandAll(executionPlanState!.theme!)}
            alt={"Expand All"}
            />
          }
          onClick={handleExpandAll}
          title={"Expand All"}
          aria-label={"Expand All"}
        />
        <ToolbarButton
          className={classes.button}
          tabIndex={0}
          icon={
            <img
            className={classes.buttonImg}
            src={utils.collapseAll(executionPlanState!.theme!)}
            alt={"Collapse All"}
            />
          }
          onClick={handleCollapseAll}
          title={"Collapse All"}
          aria-label={"Collapse All"}
        />
        <Input type="text" className={classes.inputbox} value={inputValue}  onChange={(e) => {handleInputChange(e.target.value);}}/>
      </Toolbar>
      <DataGrid
        items={items}
        columns={columns}
        focusMode="composite"
        style={{ minWidth: "250px" }}
		resizableColumns={true}
		resizableColumnsOptions={{autoFitColumns:true}}
      >
        <DataGridHeader className={classes.tableHeader}>
          <DataGridRow className={classes.tableRow}>
            {({ renderHeaderCell }) => (
              <DataGridHeaderCell className={classes.tableHeader}>{renderHeaderCell()}</DataGridHeaderCell>
            )}
          </DataGridRow>
        </DataGridHeader>
        <DataGridBody<ep.ExecutionPlanPropertyTableItem>>
			{({ item, rowId }) => (
				<>
				{(!item.isChild || shownChildren.includes(item.id)) && (
					<DataGridRow<ep.ExecutionPlanPropertyTableItem> key={rowId} className={classes.tableRow}>
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
  );
};

function mapPropertiesToItems(properties: ep.ExecutionPlanGraphElementProperty[], currentLength: number, level: number, isChild: boolean, parent: number):  ep.ExecutionPlanPropertyTableItem[] {
	let items: ep.ExecutionPlanPropertyTableItem[] = [];
	for (const property of properties) {
		let children: number[] = [];
		let childrenItems: ep.ExecutionPlanPropertyTableItem[] = [];
		if (typeof property.value !== 'string') {
			childrenItems = mapPropertiesToItems(property.value, currentLength+1, level+1, true, currentLength);

			children = childrenItems
				.map((item, index) => {
					const id = currentLength + 1 + index;
					item.id = id;
					return { id, level: item.level };
				})
				.filter(child => child.level === level + 1)
				.map(child => child.id);
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
			level: level
		}
		items.push(item);
		items = items.concat(childrenItems);
		currentLength += (childrenItems.length+1);
	}
	return items;
}

function buildItemsFromParentList(parentList: ep.ExecutionPlanPropertyTableItem[], itemList: ep.ExecutionPlanPropertyTableItem[]): ep.ExecutionPlanPropertyTableItem[] {
  let fullItemList: ep.ExecutionPlanPropertyTableItem[] = [];

  for (const parent of parentList) {
    fullItemList.push(parent);
    if (parent.children.length) {
      let childItemList: ep.ExecutionPlanPropertyTableItem[] = [];

      for (const childId of parent.children) {
        const childItem = itemList.find(item => childId === item.id);
        if (childItem) {
          childItemList.push(childItem);
        }
      }

      const childList = buildItemsFromParentList(childItemList, itemList);
      fullItemList = fullItemList.concat(childList);
    }
  }

  return fullItemList;
}

function buildFilteredItemsFromChildList(childList: ep.ExecutionPlanPropertyTableItem[], itemList: ep.ExecutionPlanPropertyTableItem[]) : ep.ExecutionPlanPropertyTableItem[] {
  let fullItemList: ep.ExecutionPlanPropertyTableItem[] = [];

  for (const child of childList) {
    if (child.parent != -1) {
      const parent = itemList.find(item => child.parent === item.id)!;
      if (parent && !fullItemList.some(fullItem => fullItem.id === parent.id)) {
        const parentList = buildFilteredItemsFromChildList([parent], itemList)
        .filter(parentItem =>
          !fullItemList.some(fullItem => fullItem.id === parentItem.id)
        );

        fullItemList = fullItemList.concat(parentList);
      }
    }
    fullItemList.push(child);
  }

  return fullItemList;
}

function sort(items: ep.ExecutionPlanPropertyTableItem[], sortOption: ep.SortOption) {
  let parentList: ep.ExecutionPlanPropertyTableItem[] = [];

  if (sortOption == ep.SortOption.Alphabetical) {
    parentList = items.filter(item => !item.isChild)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  else if (sortOption == ep.SortOption.ReverseAlphabetical) {
    parentList = items.filter(item => !item.isChild)
      .sort((a, b) => b.name.localeCompare(a.name));
  }
  else if (sortOption == ep.SortOption.Importance) {
    parentList = items.filter(item => !item.isChild)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  return buildItemsFromParentList(parentList, items);
}