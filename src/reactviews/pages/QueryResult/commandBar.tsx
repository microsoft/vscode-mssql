/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { useContext, useState } from "react";
import { QueryResultContext } from "./queryResultStateProvider";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import {
    saveAsCsvIcon,
    saveAsExcelIcon,
    saveAsJsonIcon,
} from "./queryResultUtils";
import { QueryResultSaveAsTrigger } from "../../../sharedInterfaces/queryResult";
import {
    ArrowMaximize16Filled,
    ArrowMinimize16Filled,
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
}

const CommandBar = (props: CommandBarProps) => {
    const [maxView, setMaxView] = useState(false);

    const context = useContext(QueryResultContext);
    if (context === undefined) {
        return undefined;
    }

    const webViewState = useVscodeWebview<
        qr.QueryResultWebviewState,
        qr.QueryResultReducers
    >();
    const classes = useStyles();

    const saveResults = (buttonLabel: string) => {
        void webViewState.extensionRpc.call("saveResults", {
            uri: props.uri,
            batchId: props.resultSetSummary?.batchId,
            resultId: props.resultSetSummary?.id,
            format: buttonLabel,
            selection: webViewState.state.selection,
            origin: QueryResultSaveAsTrigger.Toolbar,
        });
    };

    const hasMultipleResults =
        context.state.resultSetSummaries &&
        Object.keys(context.state.resultSetSummaries).length > 1;

    return (
        <div className={classes.commandBar}>
            {hasMultipleResults && (
                <Button
                    appearance="subtle"
                    onClick={() => {
                        maxView
                            ? props.restoreResults?.()
                            : props.maximizeResults?.();
                        setMaxView((prev) => !prev); // Toggle maxView state
                    }}
                    icon={
                        maxView ? (
                            <ArrowMinimize16Filled
                                className={classes.buttonImg}
                            />
                        ) : (
                            <ArrowMaximize16Filled
                                className={classes.buttonImg}
                            />
                        )
                    }
                    title={
                        maxView
                            ? locConstants.queryResult.restore
                            : locConstants.queryResult.maximize
                    }
                ></Button>
            )}

            <Button
                appearance="subtle"
                onClick={(_event) => {
                    saveResults("csv");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={saveAsCsvIcon(context.theme)}
                    />
                }
                className="codicon saveCsv"
                title={locConstants.queryResult.saveAsCsv}
            />
            <Button
                appearance="subtle"
                onClick={(_event) => {
                    saveResults("json");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={saveAsJsonIcon(context.theme)}
                    />
                }
                className="codicon saveJson"
                title={locConstants.queryResult.saveAsJson}
            />
            <Button
                appearance="subtle"
                onClick={(_event) => {
                    saveResults("excel");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={saveAsExcelIcon(context.theme)}
                    />
                }
                className="codicon saveExcel"
                title={locConstants.queryResult.saveAsExcel}
            />
        </div>
    );
};

export default CommandBar;
