/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import {
  createTableColumn,
  TableColumnDefinition,
  Checkbox,
  makeStyles,
  Spinner,
  DataGridHeader,
  DataGridHeaderCell,
  Text,
  TableColumnSizingOptions,
} from "@fluentui/react-components";
import {
  DataGridBody,
  DataGrid,
  DataGridRow,
  DataGridCell,
  RowRenderer,
} from "@fluentui-contrib/react-data-grid-react-window";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";
import { locConstants as loc } from "../../../common/locConstants";
import { DiffEntry } from "vscode-mssql";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useResizable } from "../../../hooks/useResizable";

const useStyles = makeStyles({
  HeaderCellPadding: {
    padding: "0 8px",
  },
  selectedRow: {
    backgroundColor: "var(--vscode-list-activeSelectionBackground)",
    color: "var(--vscode-list-activeSelectionForeground)",
    "& td": {
      backgroundColor: "var(--vscode-list-activeSelectionBackground)",
      color: "var(--vscode-list-activeSelectionForeground)",
    },
  },
  resizableContainer: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
  },
  resizer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: "100%",
    height: "8px",
    cursor: "ns-resize",
    backgroundColor: "transparent",
    zIndex: 10,
    "&:hover": {
      backgroundColor: "var(--vscode-scrollbarSlider-hoverBackground)",
      opacity: 0.5,
    },
    "&:active": {
      backgroundColor: "var(--vscode-scrollbarSlider-activeBackground)",
      opacity: 0.7,
    },
  },
  resizerHandle: {
    height: "3px",
    width: "40px",
    margin: "2px auto",
    borderRadius: "1px",
    backgroundColor: "var(--vscode-scrollbarSlider-background)",
    opacity: 0.5,
  },
  hideTextOverflow: {
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  alignSpinner: {
    marginLeft: "8px",
  },
  dataGridHeader: {
    backgroundColor: "var(--vscode-keybindingTable-headerBackground)",
  },
});

interface Props {
  onDiffSelected: (id: number) => void;
  selectedDiffId: number;
  siblingRef?: React.RefObject<HTMLDivElement>;
}

export const SchemaDifferences = React.forwardRef<HTMLDivElement, Props>(
  ({ onDiffSelected, selectedDiffId, siblingRef }, ref) => {
    const classes = useStyles();
    const context = React.useContext(schemaCompareContext);
    const compareResult = context.state.schemaCompareResult;
    const [diffInclusionLevel, setDiffInclusionLevel] = React.useState<
      "allIncluded" | "allExcluded" | "mixed"
    >("allIncluded");

    // Use the resizable hook
    const {
      ref: resizableRef,
      height,
      resizerProps,
    } = useResizable({
      initialHeight: 300,
      minHeight: 150,
      maxHeight: 800,
      siblingRef,
    });

    // Expose resizableRef via forwarded ref
    React.useImperativeHandle(ref, () => resizableRef.current!);

    React.useEffect(() => {
      let allIncluded = true;
      let allExcluded = true;
      let someIncluded = false;
      for (const diffEntry of compareResult.differences) {
        if (!diffEntry.included) {
          allIncluded = false;
        }

        if (diffEntry.included) {
          allExcluded = false;
        }
      }

      if (!allIncluded && !allExcluded) {
        someIncluded = true;
      }

      if (someIncluded) {
        setDiffInclusionLevel("mixed");
      } else if (allIncluded) {
        setDiffInclusionLevel("allIncluded");
      } else {
        setDiffInclusionLevel("allExcluded");
      }
    }, [context.state.schemaCompareResult]);

    const formatName = (nameParts: string[]): string => {
      if (!nameParts || nameParts.length === 0) {
        return "";
      }

      return nameParts.join(".");
    };

    const handleIncludeExcludeNode = (
      diffEntry: DiffEntry,
      include: boolean,
    ) => {
      if (diffEntry.position !== undefined) {
        context.includeExcludeNode(diffEntry.position, diffEntry, include);
      }
    };

    const handleIncludeExcludeAllNodes = () => {
      if (
        diffInclusionLevel === "allExcluded" ||
        diffInclusionLevel === "mixed"
      ) {
        context.includeExcludeAllNodes(true /* include all */);
      } else {
        context.includeExcludeAllNodes(false /* exclude all */);
      }
    };

    const getLabelForAction = (action: SchemaUpdateAction): string => {
      let actionLabel = "";
      switch (action) {
        case SchemaUpdateAction.Add:
          actionLabel = loc.schemaCompare.add;
          break;
        case SchemaUpdateAction.Change:
          actionLabel = loc.schemaCompare.change;
          break;
        case SchemaUpdateAction.Delete:
          actionLabel = loc.schemaCompare.delete;
          break;
      }

      return actionLabel;
    };

    const columns: TableColumnDefinition<DiffEntry>[] = [
      createTableColumn<DiffEntry>({
        columnId: "type",
        renderHeaderCell: () => loc.schemaCompare.type,
        renderCell: (item) => {
          return (
            <DataGridCell>
              <Text truncate className={classes.hideTextOverflow}>
                {item.name}
              </Text>
            </DataGridCell>
          );
        },
      }),
      createTableColumn<DiffEntry>({
        columnId: "sourceName",
        renderHeaderCell: () => loc.schemaCompare.sourceName,
        renderCell: (item) => {
          return (
            <DataGridCell>
              <Text truncate className={classes.hideTextOverflow}>
                {formatName(item.sourceValue)}
              </Text>
            </DataGridCell>
          );
        },
      }),
      createTableColumn<DiffEntry>({
        columnId: "include",
        renderHeaderCell: () => {
          if (context.state.isIncludeExcludeAllOperationInProgress) {
            return (
              <div>
                <Spinner
                  size="extra-tiny"
                  aria-label={
                    loc.schemaCompare.includeExcludeAllOperationInProgress
                  }
                  className={classes.alignSpinner}
                />
              </div>
            );
          }

          return (
            <Checkbox
              checked={
                diffInclusionLevel === "allIncluded"
                  ? true
                  : diffInclusionLevel === "mixed"
                    ? "mixed"
                    : false
              }
              onClick={() => handleIncludeExcludeAllNodes()}
              onKeyDown={toggleAllKeydown}
            />
          );
        },
        renderCell: (item) => {
          return (
            <DataGridCell>
              <Checkbox
                checked={item.included}
                onClick={() => handleIncludeExcludeNode(item, !item.included)}
                disabled={context.state.isIncludeExcludeAllOperationInProgress}
              />
            </DataGridCell>
          );
        },
      }),
      createTableColumn<DiffEntry>({
        columnId: "action",
        renderHeaderCell: () => loc.schemaCompare.action,
        renderCell: (item) => {
          return (
            <DataGridCell>
              <Text truncate className={classes.hideTextOverflow}>
                {getLabelForAction(item.updateAction as number)}
              </Text>
            </DataGridCell>
          );
        },
      }),
      createTableColumn<DiffEntry>({
        columnId: "targetName",
        renderHeaderCell: () => loc.schemaCompare.targetName,
        renderCell: (item) => {
          return (
            <DataGridCell>
              <Text truncate className={classes.hideTextOverflow}>
                {formatName(item.targetValue)}
              </Text>
            </DataGridCell>
          );
        },
      }),
    ];

    let items: DiffEntry[] = [];
    if (compareResult?.success) {
      items = compareResult.differences.map(
        (item, index) =>
          ({
            position: index,
            ...item,
          }) as DiffEntry,
      );
    }

    const toggleAllKeydown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === " ") {
        handleIncludeExcludeAllNodes();
        e.preventDefault();
      }
    };

    const toggleKeyDown = (
      e: React.KeyboardEvent<HTMLDivElement>,
      diffEntry: DiffEntry,
    ) => {
      if (e.key === "Enter") {
        if (diffEntry.position !== undefined) {
          onDiffSelected(diffEntry.position);
        }
        e.preventDefault();
      }
    };

    const renderRow: RowRenderer<DiffEntry> = ({ item, rowId }, style) => {
      return (
        <DataGridRow<DiffEntry>
          key={rowId}
          className={
            item.position === selectedDiffId ? classes.selectedRow : undefined
          }
          style={style}
          onClick={() => {
            if (item.position !== undefined) {
              onDiffSelected(item.position);
            }
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) =>
            toggleKeyDown(e, item)
          }
        >
          {({ renderCell }) => <>{renderCell(item)}</>}
        </DataGridRow>
      );
    };

    const columnSizingOptions: TableColumnSizingOptions = {
      type: {
        minWidth: 100,
      },
      sourceName: {
        minWidth: 200,
        defaultWidth: 350,
      },
      include: {
        minWidth: 60,
        defaultWidth: 60,
      },
      action: {
        minWidth: 100,
      },
      targetName: {
        minWidth: 200,
      },
    };

    return (
      <div
        className={classes.resizableContainer}
        ref={resizableRef}
        style={{ height: `${height}px` }}
      >
        <DataGrid
          items={items}
          columns={columns}
          focusMode="composite"
          resizableColumns={true}
          columnSizingOptions={columnSizingOptions}
          getRowId={(item) => (item as DiffEntry).position?.toString() ?? ""}
          size="extra-small"
        >
          <DataGridHeader className={classes.dataGridHeader}>
            <DataGridRow>
              {({ renderHeaderCell }) => (
                <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
              )}
            </DataGridRow>
          </DataGridHeader>
          <DataGridBody<DiffEntry>
            itemSize={30}
            height={height - 40}
            width={"100%"}
          >
            {renderRow}
          </DataGridBody>
        </DataGrid>

        <div {...resizerProps} className={classes.resizer}>
          <div className={classes.resizerHandle} />
        </div>
      </div>
    );
  },
);

export default SchemaDifferences;
