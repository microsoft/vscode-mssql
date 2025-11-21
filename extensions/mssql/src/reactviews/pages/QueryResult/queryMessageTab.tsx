/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  createTableColumn,
  DataGridCell,
  Link,
  makeStyles,
  TableColumnDefinition,
  TableColumnSizingOptions,
} from "@fluentui/react-components";
import * as qr from "../../../sharedInterfaces/queryResult";
import { splitMessages } from "./queryResultUtils";
import { useQueryResultSelector } from "./queryResultSelector";
import { useContext, useEffect, useRef, useState } from "react";
import { locConstants } from "../../common/locConstants";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import {
  DataGrid,
  DataGridBody,
  DataGridRow,
  RowRenderer,
} from "@fluentui-contrib/react-data-grid-react-window";

const useStyles = makeStyles({
  messagesContainer: {
    width: "100%",
    height: "100%",
    fontFamily: "var(--vscode-editor-font-family)",
    flexDirection: "column",
  },
  messagesRows: {
    lineHeight: "18px",
    fontSize: "var(--vscode-editor-font-size)",
    flexDirection: "row",
    borderBottom: "none",
  },
  messagesLink: {
    fontSize: "var(--vscode-editor-font-size)",
    fontFamily: "var(--vscode-editor-font-family)",
  },
});

export const QueryMessageTab = () => {
  const classes = useStyles();
  const context = useContext(QueryResultCommandsContext);
  if (!context) {
    return;
  }

  const uri = useQueryResultSelector<string | undefined>((s) => s.uri);
  if (!uri) {
    return;
  }
  const messages = useQueryResultSelector<qr.IMessage[]>((s) => s.messages);
  const tabStates = useQueryResultSelector((state) => state.tabStates);

  const [containerHeight, setContainerHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataGridRef = useRef<any>(null);
  const scrollOffsetRef = useRef<number>(0);

  const columnsDef: TableColumnDefinition<qr.IMessage>[] = [
    createTableColumn({
      columnId: "time",
      renderHeaderCell: () => <>{locConstants.queryResult.timestamp}</>,
      renderCell: (item) => (
        <div>
          <DataGridCell
            focusMode="group"
            style={{ minHeight: "18px", width: "100px" }}
          >
            {item.batchId === undefined ? item.time : undefined}
          </DataGridCell>
        </div>
      ),
    }),
    createTableColumn({
      columnId: "message",
      renderHeaderCell: () => <>{locConstants.queryResult.message}</>,
      renderCell: (item) => {
        if (item.link?.text && item.selection) {
          return (
            <DataGridCell focusMode="group" style={{ minHeight: "18px" }}>
              <div style={{ whiteSpace: "pre" }}>
                {item.message}{" "}
                <Link
                  className={classes.messagesLink}
                  onClick={async () => {
                    await context.extensionRpc.sendRequest(
                      qr.SetEditorSelectionRequest.type,
                      {
                        uri: item.link?.uri,
                        selectionData: item.selection,
                      },
                    );
                  }}
                  inline
                >
                  {item?.link?.text}
                </Link>
              </div>
            </DataGridCell>
          );
        } else {
          return (
            <DataGridCell focusMode="group" style={{ minHeight: "18px" }}>
              <div
                style={{
                  whiteSpace: "pre",
                  color: item.isError
                    ? "var(--vscode-errorForeground)"
                    : undefined,
                }}
              >
                {item.message}
              </div>
            </DataGridCell>
          );
        }
      },
    }),
  ];

  const [columns] = useState<TableColumnDefinition<qr.IMessage>[]>(columnsDef);

  const renderRow: RowRenderer<qr.IMessage> = ({ item, rowId }, style) => {
    return (
      <DataGridRow<qr.IMessage>
        key={rowId}
        className={classes.messagesRows}
        style={style}
        aria-label={locConstants.queryResult.message}
        role={locConstants.queryResult.message}
        aria-roledescription={locConstants.queryResult.message}
      >
        {({ renderCell }) => <>{renderCell(item)}</>}
      </DataGridRow>
    );
  };

  const items: qr.IMessage[] = splitMessages(messages);
  const sizingOptions: TableColumnSizingOptions = {
    time: {
      minWidth: 100,
      idealWidth: 100,
      defaultWidth: 100,
    },
    message: {
      minWidth: 500,
      idealWidth: 500,
      defaultWidth: 500,
    },
  };
  const [columnSizingOption] =
    useState<TableColumnSizingOptions>(sizingOptions);

  // Resize observer to track container height changes so the grid can adjust accordingly
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Restore grid view container scroll position on mount
  useEffect(() => {
    async function restoreGridViewContainerScrollPosition() {
      const scrollPosition = await context?.extensionRpc.sendRequest(
        qr.GetMessagesTabScrollPositionRequest.type,
        {
          uri: uri,
        },
      );
      if (
        scrollPosition &&
        scrollPosition.scrollTop > 0 &&
        dataGridRef.current
      ) {
        // Use scrollTo method for FixedSizeList
        dataGridRef.current.scrollTo(scrollPosition.scrollTop);
        scrollOffsetRef.current = scrollPosition.scrollTop;
      }
    }

    async function storeGridViewContainerScrollPosition() {
      if (scrollOffsetRef.current > 0) {
        await context?.extensionRpc.sendNotification(
          qr.SetMessagesTabScrollPositionNotification.type,
          {
            uri: uri,
            scrollTop: scrollOffsetRef.current,
          },
        );
      }
    }
    void restoreGridViewContainerScrollPosition();
    return () => {
      void storeGridViewContainerScrollPosition();
    };
  }, [context, uri, tabStates]);

  return (
    <div
      ref={containerRef}
      className={classes.messagesContainer}
      data-vscode-context={JSON.stringify({
        webviewSection: "queryResultMessagesPane",
        uri: uri,
      })}
    >
      <DataGrid
        items={items}
        columns={columns}
        focusMode="cell"
        resizableColumns={true}
        columnSizingOptions={columnSizingOption}
        role={locConstants.queryResult.messages}
        aria-label={locConstants.queryResult.messages}
        aria-roledescription={locConstants.queryResult.messages}
      >
        <DataGridBody<qr.IMessage>
          itemSize={18}
          height={containerHeight}
          listProps={{
            ref: dataGridRef,
            onScroll: (e: any) => {
              scrollOffsetRef.current = e.scrollOffset;
            },
          }}
        >
          {renderRow}
        </DataGridBody>
      </DataGrid>
    </div>
  );
};
