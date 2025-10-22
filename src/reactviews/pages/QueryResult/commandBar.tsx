/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Toolbar, Tooltip } from "@fluentui/react-components";
import { useContext, useState } from "react";
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
    maximizeResults?: () => void;
    restoreResults?: () => void;
    viewMode?: qr.QueryResultViewMode;
}

const CommandBar = (props: CommandBarProps) => {
    const classes = useStyles();
    const [maxView, setMaxView] = useState(false);
    const { themeKind } = useVscodeWebview2<qr.QueryResultWebviewState, qr.QueryResultReducers>();
    const context = useContext(QueryResultCommandsContext);
    const resultSetSummaries = useQueryResultSelector<
        Record<number, Record<number, qr.ResultSetSummary>>
    >((s) => s.resultSetSummaries);
    const selection = useQueryResultSelector<qr.ISlickRange[] | undefined>((s) => s.selection);

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

    if (props.viewMode === qr.QueryResultViewMode.Text) {
        return (
            <div className={classes.commandBar}>
                <Tooltip content={locConstants.queryResult.toggleToGridView} relationship="label">
                    <Button
                        appearance="subtle"
                        onClick={toggleViewMode}
                        icon={<TableRegular />}
                        title={locConstants.queryResult.toggleToGridView}
                        aria-label={locConstants.queryResult.toggleToGridView}
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
                        ? locConstants.queryResult.toggleToTextView
                        : locConstants.queryResult.toggleToGridView
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
                            ? locConstants.queryResult.toggleToTextView
                            : locConstants.queryResult.toggleToGridView
                    }
                    aria-label={
                        props.viewMode === qr.QueryResultViewMode.Grid
                            ? locConstants.queryResult.toggleToTextView
                            : locConstants.queryResult.toggleToGridView
                    }
                />
            </Tooltip>

            {hasMultipleResults() && props.viewMode === qr.QueryResultViewMode.Grid && (
                <Tooltip content={locConstants.queryResult.maximize} relationship="label">
                    <Button
                        appearance="subtle"
                        onClick={() => {
                            maxView ? props.restoreResults?.() : props.maximizeResults?.();
                            setMaxView((prev) => !prev); // Toggle maxView state
                        }}
                        icon={
                            maxView ? (
                                <ArrowMinimize16Filled className={classes.buttonImg} />
                            ) : (
                                <ArrowMaximize16Filled className={classes.buttonImg} />
                            )
                        }
                        title={
                            maxView
                                ? locConstants.queryResult.restore
                                : locConstants.queryResult.maximize
                        }
                        aria-label={
                            maxView
                                ? locConstants.queryResult.restore
                                : locConstants.queryResult.maximize
                        }></Button>
                </Tooltip>
            )}

            <Tooltip content={locConstants.queryResult.saveAsCsv} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("csv");
                    }}
                    icon={<img className={classes.buttonImg} src={saveAsCsvIcon(themeKind)} />}
                    className="codicon saveCsv"
                    title={locConstants.queryResult.saveAsCsv}
                    aria-label={locConstants.queryResult.saveAsCsv}
                />
            </Tooltip>
            <Tooltip content={locConstants.queryResult.saveAsJson} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("json");
                    }}
                    icon={<img className={classes.buttonImg} src={saveAsJsonIcon(themeKind)} />}
                    className="codicon saveJson"
                    title={locConstants.queryResult.saveAsJson}
                    aria-label={locConstants.queryResult.saveAsJson}
                />
            </Tooltip>
            <Tooltip content={locConstants.queryResult.saveAsExcel} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("excel");
                    }}
                    icon={<img className={classes.buttonImg} src={saveAsExcelIcon(themeKind)} />}
                    className="codicon saveExcel"
                    title={locConstants.queryResult.saveAsExcel}
                    aria-label={locConstants.queryResult.saveAsExcel}
                />
            </Tooltip>
            <Tooltip content={locConstants.queryResult.saveAsInsert} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("insert");
                    }}
                    icon={<img className={classes.buttonImg} src={saveAsInsertIcon(themeKind)} />}
                    className="codicon saveInsert"
                    title={locConstants.queryResult.saveAsInsert}
                    aria-label={locConstants.queryResult.saveAsInsert}
                />
            </Tooltip>
        </Toolbar>
    );
};

export default CommandBar;
