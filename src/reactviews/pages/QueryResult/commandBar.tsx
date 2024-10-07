/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { useContext } from "react";
import { QueryResultContext } from "./queryResultStateProvider";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import {
    saveAsCsvIcon,
    saveAsExcelIcon,
    saveAsJsonIcon,
} from "./queryResultUtils";

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
}

const CommandBar = (props: CommandBarProps) => {
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
        webViewState.extensionRpc.call("saveResults", {
            uri: props.uri,
            batchId: props.resultSetSummary?.batchId,
            resultId: props.resultSetSummary?.id,
            format: buttonLabel,
            selection: props.resultSetSummary?.rowCount, //TODO: do for only user selection
        });
    };

    return (
        <div className={classes.commandBar}>
            <Button
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
