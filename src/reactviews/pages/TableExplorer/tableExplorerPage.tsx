/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { useContext, useRef } from "react";
import { TableExplorerContext } from "./tableExplorerStateProvider";
import { TableExplorerCommandBar } from "./tableExplorerCommandBar";
import ResultGrid, { ResultGridHandle } from "../QueryResult/resultGrid";
import { ResultSetSummary } from "../../../sharedInterfaces/queryResult";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import * as qr from "../../../sharedInterfaces/queryResult";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
    },
});

//TODO: need to test if table explorer batch results conflict with query results batch results
//TODO: need to create a uri for the read-only select * query
//TODO: should we handle multiple result sets? no right?

export const TableExplorer = () => {
    const classes = useStyles();
    const context = useContext(TableExplorerContext);
    const tableExplorerState = context?.state;
    const gridParentRef = useRef<HTMLDivElement>(null);
    //TODO: don't need multiple result grids,
    const gridRef = useRef<ResultGridHandle>();

    const webViewState = useVscodeWebview<
        qr.QueryResultWebviewState,
        qr.QueryResultReducers
    >();

    //TODO: create a unique table explorer gridID
    const gridId = "tableExplorer1";

    if (!tableExplorerState) {
        return null;
    }

    const linkHandler = (fileContent: string, fileType: string) => {
        if (context) {
            context.provider.openFileThroughLink(fileContent, fileType);
        }
    };

    const dummyResultSetSummary: ResultSetSummary = {
        id: 1,
        batchId: 101,
        rowCount: 50,
        columnInfo: [
            {
                allowDBNull: true,
                baseCatalogName: "TestDB",
                baseColumnName: "id",
                baseSchemaName: "dbo",
                baseServerName: "localhost",
                baseTableName: "Users",
                columnName: "id",
                columnOrdinal: 1,
                columnSize: 10,
                isAliased: false,
                isAutoIncrement: true,
                isExpression: false,
                isHidden: false,
                isIdentity: true,
                isKey: true,
                isBytes: false,
                isChars: false,
                isSqlVariant: false,
                isUdt: false,
                dataType: "int",
                isXml: false,
                isJson: false,
                isLong: false,
                isReadOnly: false,
                isUnique: true,
                numericPrecision: 10,
                numericScale: 0,
                udtAssemblyQualifiedName: "System.Int32",
                dataTypeName: "INT",
            },
            {
                allowDBNull: false,
                baseCatalogName: "TestDB",
                baseColumnName: "name",
                baseSchemaName: "dbo",
                baseServerName: "localhost",
                baseTableName: "Users",
                columnName: "name",
                columnOrdinal: 2,
                columnSize: 255,
                isAliased: false,
                isAutoIncrement: false,
                isExpression: false,
                isHidden: false,
                isIdentity: false,
                isKey: false,
                isBytes: false,
                isChars: true,
                isSqlVariant: false,
                isUdt: false,
                dataType: "nvarchar",
                isXml: false,
                isJson: false,
                isLong: false,
                isReadOnly: false,
                isUnique: false,
                numericPrecision: undefined,
                numericScale: undefined,
                udtAssemblyQualifiedName: "System.String",
                dataTypeName: "NVARCHAR",
            },
        ],
    };

    let dummyData = [
        {
            displayValue: "sysxmitqueue",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "68",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "NULL",
            isNull: true,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "4",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "0",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "S ",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "SYSTEM_TABLE",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "2009-04-13 12:59:08.030",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "2024-05-01 15:25:36.500",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "1",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "0",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
        {
            displayValue: "0",
            isNull: false,
            invariantCultureDisplayValue: null,
            rowId: 0,
        },
    ];

    return (
        <div
            className={classes.root}
            ref={gridParentRef}
            style={{
                height: "600px",
                // fontFamily: context.state.fontSettings.fontFamily
                //     ? context.state.fontSettings.fontFamily
                //     : "var(--vscode-editor-font-family)",
                // fontSize: `${context.state.fontSettings.fontSize ?? 12}px`,
            }}
        >
            <TableExplorerCommandBar />
            <ResultGrid
                loadFunc={(offset: number, count: number): Thenable<any[]> => {
                    return Promise.resolve().then(() => {
                        return dummyData;
                    });
                }}
                resultSetSummary={dummyResultSetSummary}
                ref={gridRef}
                gridParentRef={gridParentRef}
                uri={tableExplorerState?.uri}
                webViewState={webViewState}
                linkHandler={linkHandler}
                gridId={gridId}
            />
        </div>
    );
};
