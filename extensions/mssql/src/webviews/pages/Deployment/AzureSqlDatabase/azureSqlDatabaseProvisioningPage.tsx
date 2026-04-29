/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { useAzureSqlDatabaseDeploymentSelector } from "../deploymentSelector";
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

export const AzureSqlDatabaseProvisioningPage: React.FC = () => {
    const classes = useStyles();
    const provisionLoadState = useAzureSqlDatabaseDeploymentSelector((s) => s.provisionLoadState);
    const errorMessage = useAzureSqlDatabaseDeploymentSelector((s) => s.errorMessage);
    const databaseName = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.databaseName);
    const deploymentStartTime = useAzureSqlDatabaseDeploymentSelector((s) => s.deploymentStartTime);
    const subscriptionId = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.formState?.subscriptionId,
    );
    const resourceGroup = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.resourceGroup);

    if (!provisionLoadState) return undefined;

    const getHeaderText = () => {
        if (provisionLoadState === ApiStatus.Error) {
            return locConstants.azureSqlDatabase.deploymentFailed;
        }
        if (provisionLoadState !== ApiStatus.Loaded) {
            return `${locConstants.azureSqlDatabase.deploymentInProgress}...`;
        }
        return locConstants.azureSqlDatabase.finishedDeployment;
    };

    return (
        <div className={classes.outerDiv}>
            <div className={classes.innerDiv}>
                <div className={classes.contentHeader}>
                    {locConstants.azureSqlDatabase.provisioning} {databaseName}
                </div>
                <DeploymentStepCard
                    status={provisionLoadState}
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
                                            {locConstants.azureSqlDatabase.deploymentName}:
                                        </span>
                                        {databaseName}
                                    </span>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.azureSqlDatabase.startTime}:
                                        </span>
                                        {deploymentStartTime}
                                    </span>
                                </div>
                                <div
                                    className={classes.cardColumn}
                                    style={{ paddingLeft: "100px" }}>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.azureSqlDatabase.subscription}:
                                        </span>
                                        {subscriptionId}
                                    </span>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.azureSqlDatabase.resourceGroup}:
                                        </span>
                                        {resourceGroup}
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
