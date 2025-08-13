/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { FabricProvisioningContext } from "./fabricProvisioningStateProvider";
import { Button, makeStyles } from "@fluentui/react-components";

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
    button: {
        height: "28px",
        width: "60px",
        marginTop: "20px",
    },
});

export const FabricProvisioningInfoPage = () => {
    const classes = useStyles();
    const state = useContext(FabricProvisioningContext);
    const fabricProvisioningState = state?.state;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !fabricProvisioningState) {
        return undefined;
    }

    const handleClick = () => {};

    return (
        <div>
            <Button className={classes.button} onClick={handleClick} appearance={"primary"}>
                Fabric Provisioning
            </Button>
        </div>
    );
};
