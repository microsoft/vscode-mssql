/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    CounterBadge,
    Divider,
    Link,
    Tab,
    TabList,
    Table,
    TableBody,
    TableCell,
    TableColumnDefinition,
    TableColumnSizingOptions,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Theme,
    createTableColumn,
    makeStyles,
    shorthands,
    teamsHighContrastTheme,
    useTableColumnSizing_unstable,
    useTableFeatures,
    webDarkTheme,
} from "@fluentui/react-components";
import { useContext, useState } from "react";
import {
    OpenFilled,
    ErrorCircleFilled,
    WarningFilled,
    InfoFilled,
} from "@fluentui/react-icons";
import Editor from "@monaco-editor/react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import {
    DesignerIssue,
    DesignerResultPaneTabs,
    InputBoxProperties,
} from "../../../sharedInterfaces/tableDesigner";
import * as l10n from "@vscode/l10n";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    ribbon: {
        width: "100%",
        display: "flex",
        flexDirection: "row",
        "> *": {
            marginRight: "10px",
        },
    },
    designerResultPaneTabs: {
        flex: 1,
    },
    tabContent: {
        ...shorthands.flex(1),
        width: "100%",
        height: "100%",
        display: "flex",
        ...shorthands.overflow("auto"),
    },
    designerResultPaneScript: {
        width: "100%",
        height: "100%",
        position: "relative",
    },
    designerResultPaneScriptOpenButton: {
        position: "absolute",
        top: "0px",
        right: "0px",
    },
    issuesContainer: {
        width: "100%",
        height: "100%",
        flexDirection: "column",
        "> *": {
            marginBottom: "10px",
        },
    },
    issuesRows: {
        flexDirection: "row",
        ...shorthands.padding("10px"),
        "> *": {
            marginRight: "10px",
        },
    },
});

export const DesignerResultPane = () => {
    const classes = useStyles();
    const state = useContext(TableDesignerContext);
    const metadata = state?.state;

    const getIssuesTabAriaLabel = (count: number) => {
        return count === 1 ? l10n.t("1 issue") : l10n.t("{0} issues", count);
    };
    const ISSUES = l10n.t("Issues");
    const GO_THERE = l10n.t("Go there");
    const OPEN_IN_NEW_TAB = l10n.t("Open in new tab");

    const getVscodeTheme = (theme: Theme) => {
        switch (theme) {
            case webDarkTheme:
                return "vs-dark";
            case teamsHighContrastTheme:
                return "hc-black";
            default:
                return "light";
        }
    };

    const columnsDef: TableColumnDefinition<DesignerIssue>[] = [
        createTableColumn({
            columnId: "severity",
            renderHeaderCell: () => <>{locConstants.tableDesigner.severity}</>,
        }),
        createTableColumn({
            columnId: "description",
            renderHeaderCell: () => (
                <>{locConstants.tableDesigner.description}</>
            ),
        }),
        createTableColumn({
            columnId: "propertyPath",
            renderHeaderCell: () => <></>,
        }),
    ];
    const [columns] =
        useState<TableColumnDefinition<DesignerIssue>[]>(columnsDef);
    const items = metadata?.issues ?? [];

    const sizingOptions: TableColumnSizingOptions = {
        severity: {
            minWidth: 50,
            idealWidth: 50,
            defaultWidth: 50,
        },
        description: {
            minWidth: 500,
            idealWidth: 500,
            defaultWidth: 500,
        },
        propertyPath: {
            minWidth: 100,
            idealWidth: 100,
            defaultWidth: 100,
        },
    };

    const [columnSizingOption] =
        useState<TableColumnSizingOptions>(sizingOptions);
    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
        {
            columns,
            items: items,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions: columnSizingOption,
            }),
        ],
    );
    const rows = getRows();

    if (!metadata) {
        return null;
    }
    return (
        <div className={classes.root}>
            <div className={classes.ribbon}>
                <TabList
                    size="medium"
                    selectedValue={metadata.tabStates!.resultPaneTab}
                    onTabSelect={(_event, data) => {
                        state.provider.setResultTab(
                            data.value as DesignerResultPaneTabs,
                        );
                    }}
                    className={classes.designerResultPaneTabs}
                >
                    <Tab
                        value={DesignerResultPaneTabs.Script}
                        key={DesignerResultPaneTabs.Script}
                    >
                        {locConstants.tableDesigner.scriptAsCreate}
                    </Tab>
                    <Tab
                        value={DesignerResultPaneTabs.Issues}
                        key={DesignerResultPaneTabs.Issues}
                        aria-label={getIssuesTabAriaLabel(
                            metadata.issues?.length!,
                        )}
                    >
                        {ISSUES}{" "}
                        {metadata.issues && (
                            <CounterBadge
                                style={{
                                    marginLeft: "5px",
                                    marginTop: "-10px",
                                }}
                                count={metadata.issues?.length}
                                size="small"
                            />
                        )}
                    </Tab>
                </TabList>
                {metadata.tabStates!.resultPaneTab ===
                    DesignerResultPaneTabs.Script && (
                    <Divider
                        vertical
                        style={{
                            flex: "0",
                        }}
                    />
                )}

                {metadata.tabStates!.resultPaneTab ===
                    DesignerResultPaneTabs.Script && (
                    <Button
                        appearance="transparent"
                        icon={<OpenFilled />}
                        onClick={() => state.provider.scriptAsCreate()}
                        title={OPEN_IN_NEW_TAB}
                    ></Button>
                )}
            </div>
            <div className={classes.tabContent}>
                {metadata.tabStates!.resultPaneTab ===
                    DesignerResultPaneTabs.Script && (
                    <div className={classes.designerResultPaneScript}>
                        <Editor
                            height={"100%"}
                            width={"100%"}
                            language="sql"
                            theme={getVscodeTheme(state!.theme!)}
                            value={
                                (
                                    metadata?.model![
                                        "script"
                                    ] as InputBoxProperties
                                ).value ?? ""
                            }
                        ></Editor>
                    </div>
                )}
                {metadata.tabStates!.resultPaneTab ===
                    DesignerResultPaneTabs.Issues && (
                    <div className={classes.issuesContainer}>
                        <Table
                            size="small"
                            as="table"
                            {...columnSizing_unstable.getTableProps()}
                            ref={tableRef}
                        >
                            <TableHeader>
                                <TableRow>
                                    {columnsDef.map((column) => {
                                        return (
                                            <TableHeaderCell
                                                {...columnSizing_unstable.getTableHeaderCellProps(
                                                    column.columnId,
                                                )}
                                                key={column.columnId}
                                            >
                                                {column.renderHeaderCell()}
                                            </TableHeaderCell>
                                        );
                                    })}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((row, index) => {
                                    return (
                                        <TableRow key={index}>
                                            <TableCell
                                                {...columnSizing_unstable.getTableCellProps(
                                                    "severity",
                                                )}
                                            >
                                                {row.item.severity ===
                                                    "error" && (
                                                    <ErrorCircleFilled
                                                        style={{
                                                            marginTop: "5px",
                                                        }}
                                                        fontSize={20}
                                                        color="red"
                                                    />
                                                )}
                                                {row.item.severity ===
                                                    "warning" && (
                                                    <WarningFilled
                                                        style={{
                                                            marginTop: "5px",
                                                        }}
                                                        fontSize={20}
                                                        color="yellow"
                                                    />
                                                )}
                                                {row.item.severity ===
                                                    "information" && (
                                                    <InfoFilled
                                                        style={{
                                                            marginTop: "5px",
                                                        }}
                                                        fontSize={20}
                                                        color="blue"
                                                    />
                                                )}
                                            </TableCell>
                                            <TableCell
                                                {...columnSizing_unstable.getTableCellProps(
                                                    "description",
                                                )}
                                            >
                                                {row.item.description}{" "}
                                                {row.item.propertyPath}
                                            </TableCell>
                                            <TableCell
                                                {...columnSizing_unstable.getTableCellProps(
                                                    "propertyPath",
                                                )}
                                            >
                                                <Link>{GO_THERE}</Link>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
        </div>
    );
};
