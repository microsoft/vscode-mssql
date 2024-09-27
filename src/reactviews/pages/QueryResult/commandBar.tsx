/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import * as utils from "./queryResultSetup";
import { useContext } from "react";
import { QueryResultContext } from "./queryResultStateProvider";
import { locConstants } from "../../common/locConstants";

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
    const classes = useStyles();

    const SAVE_PLAN = locConstants.executionPlan.savePlan;

    const handleClick = (buttonLabel) => {
        console.log(`${buttonLabel} button clicked`);
    };

    return (
        <div className={classes.commandBar}>
            <Button
                onClick={(_event) => {
                    handleClick("csv");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.saveAsCsv(queryResultState!.theme!)}
                        alt={SAVE_PLAN}
                    />
                }
                className="codicon saveCsv"
            ></Button>
            <Button
                onClick={(_event) => {
                    handleClick("json");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.saveAsJson(queryResultState!.theme!)}
                        alt={SAVE_PLAN}
                    />
                }
                className="codicon saveJson"
            ></Button>
            <Button
                onClick={(_event) => {
                    handleClick("excel");
                }}
                icon={
                    <img
                        className={classes.buttonImg}
                        src={utils.saveAsExcel(queryResultState!.theme!)}
                        alt={SAVE_PLAN}
                    />
                }
                className="codicon saveExcel"
            ></Button>
        </div>
    );
};

export default CommandBar;
