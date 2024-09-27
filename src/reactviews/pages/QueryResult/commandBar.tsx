/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import * as utils from "./queryResultSetup";
import { useContext } from "react";
import { QueryResultContext } from "./queryResultStateProvider";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import * as qr from "../../../sharedInterfaces/queryResult";

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

const CommandBar = () => {
    const state = useContext(QueryResultContext);
    const queryResultState = state?.state;
    const webViewState = useVscodeWebview<
        qr.QueryResultWebviewState,
        qr.QueryResultReducers
    >();
    const classes = useStyles();

    const saveResults = (buttonLabel: string) => {
        webViewState.extensionRpc.call("saveResults", {
            uri: queryResultState?.uri,
            batchId: queryResultState?.resultSetSummary?.batchId,
            resultId: queryResultState?.resultSetSummary?.id,
            format: buttonLabel,
            selection: queryResultState?.resultSetSummary?.rowCount, //TODO: do for only user selection
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
                        src={utils.saveAsCsv(queryResultState!.theme!)}
                    />
                }
                className="codicon saveCsv"
                title="Save As CSV"
            ></Button>
            <Button
                onClick={(_event) => {
                    saveResults("json");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.saveAsJson(queryResultState!.theme!)}
                    />
                }
                className="codicon saveJson"
                title="Save As JSON"
            ></Button>
            <Button
                onClick={(_event) => {
                    saveResults("excel");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.saveAsExcel(queryResultState!.theme!)}
                    />
                }
                className="codicon saveExcel"
                title="Save As Excel"
            ></Button>
        </div>
    );
};

export default CommandBar;
