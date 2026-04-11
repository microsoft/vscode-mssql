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
    loadingContainer: {
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--vscode-editor-background)",
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

    return <DacpacDialogForm />;
};
