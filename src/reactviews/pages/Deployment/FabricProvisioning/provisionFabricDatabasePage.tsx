/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, Card, makeStyles, Spinner, tokens } from "@fluentui/react-components";
import { Checkmark20Regular, Circle20Regular, Dismiss20Regular } from "@fluentui/react-icons";
import { FabricProvisioningHeader } from "./fabricProvisioningHeader";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { DeploymentContext } from "../deploymentStateProvider";
import { FabricProvisioningState } from "../../../../sharedInterfaces/fabricProvisioning";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        minWidth: "650px",
        minHeight: "fit-content",
        paddingBottom: "50px",
    },
    innerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        height: "fit-content",
        width: "fit-content",
        minWidth: "650px",
    },
    button: {
        height: "28px",
        width: "60px",
        marginTop: "20px",
    },
    contentHeader: {
        fontSize: "22px",
        fontWeight: 400,
        padding: "8px",
        textAlign: "left",
    },
    buttonDiv: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        width: "100%",
        padding: "8px",
        gap: "5px",
    },
    spinnerDiv: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    leftHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "18px",
        fontWeight: 400,
    },
    separatorDiv: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "4px",
        background: tokens.colorNeutralStroke2,
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px",
    },
    cardContentDiv: {
        display: "flex",
        flexDirection: "row",
        gap: "2px",
        height: "100%",
        width: "100%",
    },
    cardColumn: {
        display: "flex",
        flexDirection: "column",
        padding: "20px",
        width: "fit-content",
    },
    cardDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minHeight: "250px",
        height: "fit-content",
        width: "100%",
    },
    cardItem: {
        fontSize: "14px",
        padding: "10px",
    },
    cardItemLabel: {
        color: tokens.colorNeutralForeground4,
        paddingRight: "10px",
    },
    cardHeader: {
        width: "100%",
        fontSize: "24px",
        padding: "8px",
        textAlign: "left",
    },
});

export const ProvisionFabricDatabasePage: React.FC = () => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const fabricProvisioningState = context?.state.deploymentTypeState as FabricProvisioningState;

    if (!context || !fabricProvisioningState) return undefined;

    const getStatusIcon = () => {
        let status: ApiStatus;
        if (fabricProvisioningState.provisionLoadState !== ApiStatus.Loaded) {
            status = fabricProvisioningState.provisionLoadState;
        } else {
            status = fabricProvisioningState.connectionLoadState;
        }
        if (status === ApiStatus.NotStarted) {
            return <Circle20Regular style={{ color: tokens.colorNeutralStroke1Pressed }} />;
        }
        if (status === ApiStatus.Loaded) {
            return <Checkmark20Regular style={{ color: tokens.colorStatusSuccessBackground3 }} />;
        }
        if (status === ApiStatus.Error) {
            return <Dismiss20Regular style={{ color: tokens.colorStatusDangerBackground3 }} />;
        }
        return <Spinner size="tiny" />;
    };

    const getHeaderText = () => {
        let headerText = locConstants.fabricProvisioning.finishedDeployment;
        if (fabricProvisioningState.provisionLoadState === ApiStatus.Error) {
            headerText = locConstants.fabricProvisioning.deploymentFailed;
        } else if (fabricProvisioningState.provisionLoadState !== ApiStatus.Loaded) {
            headerText = `${locConstants.fabricProvisioning.deploymentInProgress}...`;
        } else if (fabricProvisioningState.connectionLoadState === ApiStatus.Error) {
            headerText = locConstants.fabricProvisioning.connectionFailed;
        } else if (fabricProvisioningState.connectionLoadState !== ApiStatus.Loaded) {
            headerText = `${locConstants.fabricProvisioning.connectingToDatabase}`;
        }
        return headerText;
    };

    return (
        <div>
            <FabricProvisioningHeader />
            <div className={classes.outerDiv}>
                <div className={classes.innerDiv}>
                    <div className={classes.contentHeader}>
                        {locConstants.fabricProvisioning.provisioning}{" "}
                        {fabricProvisioningState.formState.databaseName}
                    </div>
                    <Card className={classes.cardDiv}>
                        <div className={classes.separatorDiv} />
                        <div className={classes.cardHeader}>
                            <div className={classes.leftHeader}>
                                {getStatusIcon()}
                                {getHeaderText()}
                            </div>
                        </div>
                        <div className={classes.cardContentDiv}>
                            {fabricProvisioningState.errorMessage ? (
                                <div className={classes.cardColumn}>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.common.error}:
                                        </span>
                                        {fabricProvisioningState.errorMessage}
                                    </span>
                                </div>
                            ) : (
                                <>
                                    <div className={classes.cardColumn}>
                                        <span className={classes.cardItem}>
                                            <span className={classes.cardItemLabel}>
                                                {locConstants.fabricProvisioning.deploymentName}:
                                            </span>
                                            {fabricProvisioningState.formState.databaseName}
                                        </span>
                                        <span className={classes.cardItem}>
                                            <span className={classes.cardItemLabel}>
                                                {locConstants.fabricProvisioning.startTime}:
                                            </span>
                                            {fabricProvisioningState.deploymentStartTime}
                                        </span>
                                    </div>
                                    <div
                                        className={classes.cardColumn}
                                        style={{ paddingLeft: "100px" }}>
                                        <span className={classes.cardItem}>
                                            <span className={classes.cardItemLabel}>
                                                {locConstants.azure.tenant}:
                                            </span>
                                            {fabricProvisioningState.tenantName}
                                        </span>
                                        <span className={classes.cardItem}>
                                            <span className={classes.cardItemLabel}>
                                                {locConstants.fabricProvisioning.workspace}:
                                            </span>
                                            {fabricProvisioningState.workspaceName}
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    </Card>
                    {fabricProvisioningState.connectionLoadState === ApiStatus.Loaded && (
                        <div className={classes.buttonDiv}>
                            <Button
                                className={classes.button}
                                onClick={() => context.dispose()}
                                appearance="primary">
                                {locConstants.common.finish}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
