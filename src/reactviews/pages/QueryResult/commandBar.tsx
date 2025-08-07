/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Tooltip } from "@fluentui/react-components";
import { useContext, useState } from "react";
import { QueryResultContext } from "./queryResultStateProvider";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import { saveAsCsvIcon, saveAsExcelIcon, saveAsJsonIcon } from "./queryResultUtils";
import { QueryResultSaveAsTrigger } from "../../../sharedInterfaces/queryResult";
import {
    ArrowMaximize16Filled,
    ArrowMinimize16Filled,
    DocumentTextRegular,
    TableRegular,
} from "@fluentui/react-icons";

const useStyles = makeStyles({
    commandBar: {
        display: "flex",
        flexDirection: "column" /* Align buttons vertically */,
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
    const [maxView, setMaxView] = useState(false);

    const context = useContext(QueryResultContext);
    if (context === undefined) {
        return undefined;
    }

    const webViewState = useVscodeWebview<qr.QueryResultWebviewState, qr.QueryResultReducers>();
    const classes = useStyles();

    const saveResults = (buttonLabel: string) => {
        void webViewState.extensionRpc.sendRequest(qr.SaveResultsWebviewRequest.type, {
            uri: props.uri ?? "",
            batchId: props.resultSetSummary?.batchId,
            resultId: props.resultSetSummary?.id,
            format: buttonLabel,
            selection: webViewState.state.selection,
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
        if (Object.keys(context.state.resultSetSummaries).length > 1) {
            return true;
        }
        for (let resultSet of Object.values(context.state.resultSetSummaries)) {
            if (Object.keys(resultSet).length > 1) {
                return true;
            }
        }
        return false;
    };

    const hasMultipleResults = () => {
        return Object.keys(context.state.resultSetSummaries).length > 0 && checkMultipleResults();
    };

    return (
        <div className={classes.commandBar}>
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
                        }></Button>
                </Tooltip>
            )}

            <Tooltip content={locConstants.queryResult.saveAsCsv} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("csv");
                    }}
                    icon={
                        <img className={classes.buttonImg} src={saveAsCsvIcon(context.themeKind)} />
                    }
                    className="codicon saveCsv"
                    title={locConstants.queryResult.saveAsCsv}
                />
            </Tooltip>
            <Tooltip content={locConstants.queryResult.saveAsJson} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("json");
                    }}
                    icon={
                        <img
                            className={classes.buttonImg}
                            src={saveAsJsonIcon(context.themeKind)}
                        />
                    }
                    className="codicon saveJson"
                    title={locConstants.queryResult.saveAsJson}
                />
            </Tooltip>
            <Tooltip content={locConstants.queryResult.saveAsExcel} relationship="label">
                <Button
                    appearance="subtle"
                    onClick={(_event) => {
                        saveResults("excel");
                    }}
                    icon={
                        <img
                            className={classes.buttonImg}
                            src={saveAsExcelIcon(context.themeKind)}
                        />
                    }
                    className="codicon saveExcel"
                    title={locConstants.queryResult.saveAsExcel}
                />
            </Tooltip>
        </div>
    );
};

export default CommandBar;
