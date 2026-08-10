/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { useAzureSqlDatabaseDeploymentSelector } from "../deploymentSelector";
import { DeploymentStepCard } from "../deploymentStepCard";
import { ConnectToDatabaseCard } from "../connectToDatabaseCard";
import { WhatsNextCard } from "../whatsNextCard";
import { DeploymentContext } from "../deploymentStateProvider";
import { PostDeploymentScript } from "../postDeploymentScriptsDrawer";
import { DeploymentScriptsCard } from "../deploymentScriptsCard";
import {
    generateAzureSqlDatabaseArm,
    generateAzureSqlDatabaseBicep,
    generateAzureSqlDatabaseTerraform,
} from "../deploymentScripts";

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
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    cardItemError: {
        fontSize: "14px",
        padding: "10px 0",
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
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
    const context = useContext(DeploymentContext);
    const provisionLoadState = useAzureSqlDatabaseDeploymentSelector((s) => s.provisionLoadState);
    const connectionLoadState = useAzureSqlDatabaseDeploymentSelector((s) => s.connectionLoadState);
    const errorMessage = useAzureSqlDatabaseDeploymentSelector((s) => s.errorMessage);
    const databaseName = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.databaseName);
    const deploymentStartTime = useAzureSqlDatabaseDeploymentSelector((s) => s.deploymentStartTime);
    const subscriptionName = useAzureSqlDatabaseDeploymentSelector((s) => s.subscriptionName);
    const resourceGroup = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.resourceGroup);
    const serverName = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.serverName);
    const collation = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.collation);
    const freeLimitBehavior = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.formState?.freeLimitBehavior,
    );
    const maxVcores = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.maxVcores);
    const serverRegion = useAzureSqlDatabaseDeploymentSelector((s) => s.serverRegion);
    const connectionString = useAzureSqlDatabaseDeploymentSelector((s) => s.connectionString);

    const scriptBaseName = (databaseName || "database").replace(/[^a-zA-Z0-9-_]/g, "_");
    const scripts = useMemo<PostDeploymentScript[]>(() => {
        const params = {
            databaseName,
            serverName,
            collation,
            freeLimitBehavior,
            maxVcores,
            subscriptionName,
            resourceGroup,
        };
        return [
            {
                id: "arm",
                label: locConstants.deploymentScripts.armTemplate,
                content: generateAzureSqlDatabaseArm(params),
                fileName: `${scriptBaseName}.json`,
            },
            {
                id: "bicep",
                label: locConstants.deploymentScripts.bicep,
                content: generateAzureSqlDatabaseBicep(params),
                fileName: `${scriptBaseName}.bicep`,
            },
            {
                id: "terraform",
                label: locConstants.deploymentScripts.terraform,
                content: generateAzureSqlDatabaseTerraform(params),
                fileName: `${scriptBaseName}.tf`,
            },
        ];
    }, [
        databaseName,
        serverName,
        collation,
        freeLimitBehavior,
        maxVcores,
        subscriptionName,
        resourceGroup,
        scriptBaseName,
    ]);

    if (!provisionLoadState) return undefined;

    const deploymentSucceeded = provisionLoadState === ApiStatus.Loaded;

    const stepStatus =
        provisionLoadState !== ApiStatus.Loaded ? provisionLoadState : connectionLoadState;

    const getHeaderText = () => {
        if (provisionLoadState === ApiStatus.Error) {
            return locConstants.azureSqlDatabase.deploymentFailed;
        }
        if (provisionLoadState !== ApiStatus.Loaded) {
            return `${locConstants.azureSqlDatabase.deploymentInProgress}...`;
        }
        if (connectionLoadState === ApiStatus.Error) {
            return locConstants.azureSqlDatabase.connectionFailed;
        }
        if (connectionLoadState !== ApiStatus.Loaded) {
            return locConstants.azureSqlDatabase.connectingToDatabase;
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
                    status={stepStatus}
                    title={getHeaderText()}
                    className={classes.cardDiv}
                    bodyClassName={classes.cardBody}>
                    <div className={classes.cardContentDiv}>
                        {errorMessage ? (
                            <div className={classes.cardColumn} style={{ paddingRight: "20px" }}>
                                <span className={classes.cardItemError}>
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
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.azureSqlDatabase.server}:
                                        </span>
                                        {serverName}
                                    </span>
                                </div>
                                <div className={classes.cardColumn}>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.azureSqlDatabase.subscription}:
                                        </span>
                                        {subscriptionName}
                                    </span>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.azureSqlDatabase.resourceGroup}:
                                        </span>
                                        {resourceGroup}
                                    </span>
                                    <span className={classes.cardItem}>
                                        <span className={classes.cardItemLabel}>
                                            {locConstants.azureSqlDatabase.region}:
                                        </span>
                                        {serverRegion}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </DeploymentStepCard>
                {connectionLoadState === ApiStatus.Loaded && connectionString && (
                    <ConnectToDatabaseCard connectionString={connectionString} />
                )}
                {deploymentSucceeded && (
                    <DeploymentScriptsCard
                        scripts={scripts}
                        onDownload={(content, fileName) =>
                            context?.downloadDeploymentScript(content, fileName)
                        }
                        onAddToWorkspace={(content, fileName) =>
                            context?.addDeploymentScriptToWorkspace(content, fileName)
                        }
                    />
                )}
                {connectionLoadState === ApiStatus.Loaded && <WhatsNextCard />}
            </div>
        </div>
    );
};
