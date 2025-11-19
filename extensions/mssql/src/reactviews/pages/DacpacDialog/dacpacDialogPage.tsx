/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles, Spinner } from "@fluentui/react-components";
import { DacpacDialogContext } from "./dacpacDialogStateProvider";
import { DacpacDialogForm } from "./dacpacDialogForm";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    outerContainer: {
        height: "100%",
        width: "100%",
        overflowY: "auto",
        overflowX: "auto",
    },
    loadingContainer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
});

export const DacpacDialogPage = () => {
    const classes = useStyles();
    const context = useContext(DacpacDialogContext);

    if (!context) {
        return (
            <div className={classes.loadingContainer}>
                <Spinner label={locConstants.dacpacDialog.loading} labelPosition="below" />
            </div>
        );
    }

    return (
        <div className={classes.outerContainer}>
            <DacpacDialogForm />
        </div>
    );
};
