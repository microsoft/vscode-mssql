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
import * as l10n from "@vscode/l10n";

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
    const context = useContext(QueryResultContext);
    const queryResultState = context?.state;
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
                        src={utils.saveAsCsv(context!.theme!)}
                    />
                }
                className="codicon saveCsv"
                title={l10n.t("Save as CSV")}
            />
            <Button
                onClick={(_event) => {
                    saveResults("json");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.saveAsJson(context!.theme!)}
                    />
                }
                className="codicon saveJson"
                title={l10n.t("Save as JSON")}
            />
            <Button
                onClick={(_event) => {
                    saveResults("excel");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.saveAsExcel(context!.theme!)}
                    />
                }
                className="codicon saveExcel"
                title={l10n.t("Save as Excel")}
            />
        </div>
    );
};

export default CommandBar;
