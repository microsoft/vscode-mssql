/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { DeploymentContext } from "./deploymentStateProvider";
import { LocalContainersStartPage } from "./LocalContainers/localContainersStartPage";
import { DeploymentType } from "../../../sharedInterfaces/deployment";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        minWidth: "750px",
        minHeight: "fit-content",
    },
    stepsDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        width: "500px",
    },
    button: {
        height: "28px",
        width: "fit-content",
        textWrap: "nowrap",
        marginTop: "20px",
        marginBottom: "20px",
    },
    itemDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "row",
        height: "fit-content",
        padding: "10px",
    },
    textDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "left",
        gap: "10px",
        width: "425px",
    },
    titleDiv: {
        fontWeight: "bold",
    },
    icon: {
        marginTop: "-10px",
        width: "75px",
        height: "75px",
        marginRight: "10px",
    },
    link: {
        textDecoration: "none",
    },
});

export const ChooseDeploymentTypePage: React.FC = () => {
    const classes = useStyles();
    const state = useContext(DeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const deploymentState = state?.state;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !deploymentState) {
        return undefined;
    }

    const handleChoice = async (choice: DeploymentType) => {
        // reset step states
        await state.initializeDeploymentSpecifics(choice);
        setShowNext(true);
    };

    useEffect(() => {}, [deploymentState.isDeploymentTypeInitialized]);

    return showNext && deploymentState.isDeploymentTypeInitialized ? (
        <LocalContainersStartPage />
    ) : (
        <div>
            <Button
                className={classes.button}
                onClick={() => handleChoice(DeploymentType.LocalContainers)}
                appearance={"primary"}>
                Local Containers
            </Button>
            <Button
                className={classes.button}
                onClick={() => handleChoice(DeploymentType.FabricProvisioning)}
                appearance={"primary"}>
                Fabric Provisioning
            </Button>
        </div>
    );
};
