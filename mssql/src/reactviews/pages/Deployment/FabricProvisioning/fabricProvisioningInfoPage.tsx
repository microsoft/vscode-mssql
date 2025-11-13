/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { DeploymentContext } from "../deploymentStateProvider";
import { DeploymentType } from "../../../../sharedInterfaces/deployment";
import { ChevronLeft20Regular } from "@fluentui/react-icons";
import { ChooseDeploymentTypePage } from "../chooseDeploymentTypePage";
import { FabricProvisioningStartPage } from "./fabricProvisioningStartPage";
import { FabricProvisioningHeader } from "./fabricProvisioningHeader";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
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
    backButton: {
        position: "absolute",
        top: "10px",
        left: "10px",
    },
    itemDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "row",
        height: "fit-content",
        padding: "25px",
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

export const FabricProvisioningInfoPage: React.FC = () => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const [showPrevious, setShowPrevious] = useState(false);

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!context) {
        return undefined;
    }
    return showPrevious ? (
        <ChooseDeploymentTypePage />
    ) : showNext ? (
        <FabricProvisioningStartPage />
    ) : (
        <div>
            <Button
                className={classes.backButton}
                onClick={() => setShowPrevious(true)}
                appearance="transparent">
                <ChevronLeft20Regular style={{ marginRight: "4px" }} />
                {locConstants.common.back}
            </Button>
            <FabricProvisioningHeader />
            <div className={classes.outerDiv}>
                <div className={classes.stepsDiv}>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={builtOnAzureSQL()}
                            alt={locConstants.fabricProvisioning.builtOnAzureSQL}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.fabricProvisioning.builtOnAzureSQL}
                            </div>
                            <div>{locConstants.fabricProvisioning.builtOnAzureSQLDescription}</div>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={analyticsReady()}
                            alt={locConstants.fabricProvisioning.analyticsReady}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.fabricProvisioning.analyticsReady}
                            </div>
                            <div>{locConstants.fabricProvisioning.analyticsReadyDescription}</div>
                        </div>
                    </div>
                    <div className={classes.itemDiv}>
                        <img
                            className={classes.icon}
                            src={integratedAndSecure()}
                            alt={locConstants.fabricProvisioning.integratedAndSecure}
                        />
                        <div className={classes.textDiv}>
                            <div className={classes.titleDiv}>
                                {locConstants.fabricProvisioning.integratedAndSecure}
                            </div>
                            <div>
                                {locConstants.fabricProvisioning.integratedAndSecureDescription}
                            </div>
                        </div>
                    </div>
                    <Button
                        className={classes.button}
                        onClick={() => {
                            context.initializeDeploymentSpecifics(
                                DeploymentType.FabricProvisioning,
                            );
                            setShowNext(true);
                        }}
                        appearance={"primary"}>
                        {locConstants.common.getStarted}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export const builtOnAzureSQL = () => {
    return require(`../../../media/builtOnAzureSql.svg`);
};

export const analyticsReady = () => {
    return require(`../../../media/analyticsReady.svg`);
};

export const integratedAndSecure = () => {
    return require(`../../../media/instantSetup.svg`);
};
