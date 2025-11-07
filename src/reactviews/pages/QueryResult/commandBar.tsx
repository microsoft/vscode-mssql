/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Toolbar, Tooltip } from "@fluentui/react-components";
import { useContext } from "react";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { useQueryResultSelector } from "./queryResultSelector";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import {
    saveAsCsvIcon,
    saveAsExcelIcon,
    saveAsJsonIcon,
    saveAsInsertIcon,
} from "./queryResultUtils";
import { QueryResultSaveAsTrigger } from "../../../sharedInterfaces/queryResult";
import {
    ArrowMaximize16Filled,
    ArrowMinimize16Filled,
    DocumentTextRegular,
    TableRegular,
} from "@fluentui/react-icons";
import { WebviewAction } from "../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    commandBar: {
        width: "16px",
    },
    buttonImg: {
        display: "block",
        height: "16px",
        width: "16px",
    },
});

export interface CommandBarProps {
    uri?: string;
    resultSetSummary?: qr.ResultSetSummary;
    viewMode?: qr.QueryResultViewMode;
    onToggleMaximize?: () => void;
    isMaximized?: boolean;
}

const CommandBar = (props: CommandBarProps) => {
    const classes = useStyles();
    const { themeKind } = useVscodeWebview2<qr.QueryResultWebviewState, qr.QueryResultReducers>();
    const context = useContext(QueryResultCommandsContext);
    const resultSetSummaries = useQueryResultSelector<
        Record<number, Record<number, qr.ResultSetSummary>>
    >((s) => s.resultSetSummaries);
    const selection = useQueryResultSelector<qr.ISlickRange[] | undefined>((s) => s.selection);
    const { keyBindings } = useVscodeWebview2();

    const maximizeShortcut = keyBindings[WebviewAction.QueryResultMaximizeGrid];
    const restoreShortcut = keyBindings[WebviewAction.QueryResultMaximizeGrid];
    const toggleViewShortcut = keyBindings[WebviewAction.QueryResultSwitchToTextView];
    const saveAsJsonShortcut = keyBindings[WebviewAction.QueryResultSaveAsJson];
    const saveAsCsvShortcut = keyBindings[WebviewAction.QueryResultSaveAsCsv];
    const saveAsExcelShortcut = keyBindings[WebviewAction.QueryResultSaveAsExcel];
    const saveAsInsertShortcut = keyBindings[WebviewAction.QueryResultSaveAsInsert];

    if (context === undefined) {
        return undefined;
    }

    const saveResults = (buttonLabel: string) => {
        void context.extensionRpc.sendRequest(qr.SaveResultsWebviewRequest.type, {
            uri: props.uri ?? "",
            batchId: props.resultSetSummary?.batchId,
            resultId: props.resultSetSummary?.id,
            format: buttonLabel,
            selection: selection,
            origin: QueryResultSaveAsTrigger.Toolbar,
        });
    };

    const toggleViewMode = () => {
        const newMode =
            props.viewMode === qr.QueryResultViewMode.Grid
                ? qr.QueryResultViewMode.Text
                : qr.QueryResultViewMode.Grid;
        context.setResultViewMode(newMode);
    };

    const checkMultipleResults = () => {
        if (Object.keys(resultSetSummaries).length > 1) {
            return true;
        }
        for (let resultSet of Object.values(resultSetSummaries)) {
            if (Object.keys(resultSet).length > 1) {
                return true;
            }
        }
        return false;
    };

    const hasMultipleResults = () => {
        return Object.keys(resultSetSummaries).length > 0 && checkMultipleResults();
    };

    const isMaximized = props.isMaximized ?? false;
    const maximizeTooltip = locConstants.queryResult.maximize(maximizeShortcut?.label);
    const restoreTooltip = locConstants.queryResult.restore(restoreShortcut?.label);
    const toggleToGridViewTooltip = locConstants.queryResult.toggleToGridView(
        toggleViewShortcut?.label,
    );
    const toggleToTextViewTooltip = locConstants.queryResult.toggleToTextView(
        toggleViewShortcut?.label,
    );
    const saveAsCsvTooltip = locConstants.queryResult.saveAsCsv(saveAsCsvShortcut?.label);
    const saveAsJsonTooltip = locConstants.queryResult.saveAsJson(saveAsJsonShortcut?.label);
    const saveAsExcelTooltip = locConstants.queryResult.saveAsExcel(saveAsExcelShortcut?.label);
    const saveAsInsertTooltip = locConstants.queryResult.saveAsInsert(saveAsInsertShortcut?.label);

    if (props.viewMode === qr.QueryResultViewMode.Text) {
        return (
            <div className={classes.commandBar}>
                <Tooltip content={toggleToGridViewTooltip} relationship="label">
                    <Button
                        appearance="subtle"
                        onClick={toggleViewMode}
                        icon={<TableRegular />}
                        title={toggleToGridViewTooltip}
                    />
                </Tooltip>
            </div>
        );
    }

    return (
        <Toolbar vertical className={classes.commandBar}>
            {/* View Mode Toggle */}
            <Tooltip
                content={
                    props.viewMode === qr.QueryResultViewMode.Grid
                        ? toggleToTextViewTooltip
                        : toggleToGridViewTooltip
                }
                relationship="label">
                <Button
                    appearance="subtle"
                    onClick={toggleViewMode}
                    icon={
                        props.viewMode === qr.QueryResultViewMode.Grid ? (
                            <DocumentTextRegular />
                        ) : (
                            <TableRegular />
                        )
                    }
                    title={
                        props.viewMode === qr.QueryResultViewMode.Grid
                            ? toggleToTextViewTooltip
                            : toggleToGridViewTooltip
                    }
                />
            </Tooltip>

            {hasMultipleResults() && props.viewMode === qr.QueryResultViewMode.Grid && (
                <Tooltip
                    content={isMaximized ? restoreTooltip : maximizeTooltip}
                    relationship="label">
                    <Button
                        appearance="subtle"
                        onClick={() => {
                            props.onToggleMaximize?.();
                        }}
                        icon={
                            isMaximized ? (
                                <ArrowMinimize16Filled className={classes.buttonImg} />
                            ) : (
                                <ArrowMaximize16Filled className={classes.buttonImg} />
                            )
                        }
                        title={isMaximized ? restoreTooltip : maximizeTooltip}></Button>
                </Tooltip>
            )}

            <Tooltip content={saveAsCsvTooltip} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("csv");
                    }}
                    icon={<img className={classes.buttonImg} src={saveAsCsvIcon(themeKind)} />}
                    className="codicon saveCsv"
                    title={saveAsCsvTooltip}
                />
            </Tooltip>
            <Tooltip content={saveAsJsonTooltip} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("json");
                    }}
                    icon={<img className={classes.buttonImg} src={saveAsJsonIcon(themeKind)} />}
                    className="codicon saveJson"
                    title={saveAsJsonTooltip}
                />
            </Tooltip>
            <Tooltip content={saveAsExcelTooltip} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("excel");
                    }}
                    icon={<img className={classes.buttonImg} src={saveAsExcelIcon(themeKind)} />}
                    className="codicon saveExcel"
                    title={saveAsExcelTooltip}
                />
            </Tooltip>
            <Tooltip content={saveAsInsertTooltip} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("insert");
                    }}
                    icon={<img className={classes.buttonImg} src={saveAsInsertIcon(themeKind)} />}
                    className="codicon saveInsert"
                    title={saveAsInsertTooltip}
                />
            </Tooltip>
        </Toolbar>
    );
};

export default CommandBar;
