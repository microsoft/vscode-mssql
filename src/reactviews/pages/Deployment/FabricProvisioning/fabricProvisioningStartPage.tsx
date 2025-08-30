/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { FabricProvisioningInfoPage } from "./fabricProvisioningInfoPage";
import { DeploymentContext } from "../deploymentStateProvider";
import { FabricProvisioningWebviewState } from "../../../../sharedInterfaces/fabricProvisioning";

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

export const FabricProvisioningStartPage = () => {
    const classes = useStyles();
    const state = useContext(DeploymentContext);
    const fabricProvisioningState = state?.state
        .deploymentTypeState as FabricProvisioningWebviewState;

    const renderMainContent = () => {
        switch (fabricProvisioningState?.loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner
                            label={locConstants.localContainers.loadingDeploymentPage}
                            labelPosition="below"
                        />
                    </div>
                );
            case ApiStatus.Loaded:
                return <FabricProvisioningInfoPage />;
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{fabricProvisioningState?.errorMessage ?? ""}</Text>
                    </div>
                );
        }
    };

    return <div className={classes.outerDiv}>{renderMainContent()}</div>;
};
