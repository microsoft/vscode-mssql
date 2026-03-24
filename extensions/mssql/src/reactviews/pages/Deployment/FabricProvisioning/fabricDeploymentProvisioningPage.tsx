/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { useDeploymentSelector } from "../deploymentSelector";
import { FabricProvisioningState } from "../../../../sharedInterfaces/fabricProvisioning";
import { DeploymentStepCard } from "../deploymentStepCard";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        width: "100%",
        minWidth: 0,
        minHeight: "fit-content",
    },
    innerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        height: "fit-content",
        width: "100%",
        minWidth: 0,
    },
    contentHeader: {
        fontSize: "22px",
        fontWeight: 400,
        padding: "0",
        textAlign: "left",
    },
    cardContentDiv: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: "0",
        width: "100%",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    cardColumn: {
        display: "flex",
        flexDirection: "column",
        padding: "20px",
        width: "100%",
        minWidth: 0,
    },
    cardDiv: {
        width: "100%",
    },
    cardItem: {
        fontSize: "14px",
        padding: "10px 0",
    },
    cardItemLabel: {
        color: tokens.colorNeutralForeground4,
        paddingRight: "10px",
    },
    cardBody: {
        padding: "0",
    },
});

export const FabricDeploymentProvisioningPage: React.FC = () => {
    const classes = useStyles();
    const provisionLoadState = useDeploymentSelector(
        (s) => (s.deploymentTypeState as FabricProvisioningState)?.provisionLoadState,
    );
    const connectionLoadState = useDeploymentSelector(
        (s) => (s.deploymentTypeState as FabricProvisioningState)?.connectionLoadState,
    );
    const errorMessage = useDeploymentSelector(
        (s) => (s.deploymentTypeState as FabricProvisioningState)?.errorMessage,
    );
    const databaseName = useDeploymentSelector(
        (s) => (s.deploymentTypeState as FabricProvisioningState)?.formState?.databaseName,
    );
    const deploymentStartTime = useDeploymentSelector(
        (s) => (s.deploymentTypeState as FabricProvisioningState)?.deploymentStartTime,
    );
    const tenantName = useDeploymentSelector(
        (s) => (s.deploymentTypeState as FabricProvisioningState)?.tenantName,
    );
    const workspaceName = useDeploymentSelector(
        (s) => (s.deploymentTypeState as FabricProvisioningState)?.workspaceName,
    );

    if (!provisionLoadState) return undefined;

    const stepStatus =
        provisionLoadState !== ApiStatus.Loaded ? provisionLoadState : connectionLoadState;

    const getHeaderText = () => {
        let headerText = locConstants.fabricProvisioning.finishedDeployment;
        if (provisionLoadState === ApiStatus.Error) {
            headerText = locConstants.fabricProvisioning.deploymentFailed;
        } else if (provisionLoadState !== ApiStatus.Loaded) {
            headerText = `${locConstants.fabricProvisioning.deploymentInProgress}...`;
        } else if (connectionLoadState === ApiStatus.Error) {
            headerText = locConstants.fabricProvisioning.connectionFailed;
        } else if (connectionLoadState !== ApiStatus.Loaded) {
            headerText = `${locConstants.fabricProvisioning.connectingToDatabase}`;
        }
        return headerText;
    };

    return (
        <div className={classes.outerDiv}>
            <div className={classes.innerDiv}>
                <div className={classes.contentHeader}>
                    {locConstants.fabricProvisioning.provisioning} {databaseName}
                </div>
                <DeploymentStepCard
                    status={stepStatus}
                    title={getHeaderText()}
                    className={classes.cardDiv}
                    bodyClassName={classes.cardBody}>
                    <div className={classes.cardContentDiv}>
                        {errorMessage ? (
                            <div className={classes.cardColumn}>
                                <span className={classes.cardItem}>
                                    <span className={classes.cardItemLabel}>
                                        {locConstants.common.error}:
                                    </span>
                                    {errorMessage}
                                </span>
                            </div>
                        ) : (
                            <>
                                <div className={classes.cardColumn}>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.fabricProvisioning.deploymentName}:
                                        </span>
                                        {databaseName}
                                    </span>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.fabricProvisioning.startTime}:
                                        </span>
                                        {deploymentStartTime}
                                    </span>
                                </div>
                                <div
                                    className={classes.cardColumn}
                                    style={{ paddingLeft: "100px" }}>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.azure.tenant}:
                                        </span>
                                        {tenantName}
                                    </span>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.fabricProvisioning.workspace}:
                                        </span>
                                        {workspaceName}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </DeploymentStepCard>
            </div>
        </div>
    );
};
