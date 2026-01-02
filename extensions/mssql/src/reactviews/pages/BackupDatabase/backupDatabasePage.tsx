/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { BackupDatabaseContext } from "./backupDatabaseStateProvider";
import { useBackupDatabaseSelector } from "./backupDatabaseSelector";

const useStyles = makeStyles({
    outerDiv: {
        height: "100%",
        width: "100%",
        position: "relative",
        overflowY: "auto",
        overflowX: "unset",
    },
    spinnerDiv: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
});

export const BackupDatabasePage = () => {
    const classes = useStyles();
    const context = useContext(BackupDatabaseContext);

    if (!context) {
        return;
    }

    const state = useBackupDatabaseSelector((s) => s);

    const renderMainContent = () => {
        switch (state?.loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.backupDatabase.loadingBackupDatabase}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                return (<div className={classes.spinnerDiv}>
                    <label>{state?.databaseNode?.label}</label>
                    <button
                        onClick={() => {
                            console.log("Button clicked for:", state?.databaseNode?.label);
                            context.backupDatabase()
                            // You can replace this with any action you want
                        }}>
                    </button>
                </div>);
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{state?.errorMessage ?? ""}</Text>
                    </div>
                );
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};
