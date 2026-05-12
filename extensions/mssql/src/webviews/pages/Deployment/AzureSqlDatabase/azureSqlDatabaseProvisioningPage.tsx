/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Text, tokens } from "@fluentui/react-components";
import { ArrowRight12Regular } from "@fluentui/react-icons";
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
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    cardItemLabel: {
        color: tokens.colorNeutralForeground4,
        paddingRight: "10px",
    },
    cardBody: {
        padding: "0",
    },
    docsCard: {
        borderRadius: "12px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--colorNeutralBackground1Hover)",
        padding: "16px",
        width: "100%",
        boxSizing: "border-box",
    },
    docsTitle: {
        display: "block",
        marginBottom: "8px",
        fontSize: "13px",
        fontWeight: 600,
        lineHeight: "16px",
    },
    docsActions: {
        display: "flex",
        flexDirection: "column",
    },
    docsAction: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minHeight: "24px",
        padding: "2px 0",
        fontSize: "13px",
        lineHeight: "18px",
        color: "var(--vscode-textLink-foreground)",
        textDecorationLine: "none",
    },
});

export const AzureSqlDatabaseProvisioningPage: React.FC = () => {
    const classes = useStyles();
    const provisionLoadState = useAzureSqlDatabaseDeploymentSelector((s) => s.provisionLoadState);
    const connectionLoadState = useAzureSqlDatabaseDeploymentSelector((s) => s.connectionLoadState);
    const errorMessage = useAzureSqlDatabaseDeploymentSelector((s) => s.errorMessage);
    const databaseName = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.databaseName);
    const deploymentStartTime = useAzureSqlDatabaseDeploymentSelector((s) => s.deploymentStartTime);
    const subscriptionName = useAzureSqlDatabaseDeploymentSelector((s) => s.subscriptionName);
    const resourceGroup = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.resourceGroup);
    const serverName = useAzureSqlDatabaseDeploymentSelector((s) => s.formState?.serverName);
    const serverRegion = useAzureSqlDatabaseDeploymentSelector((s) => s.serverRegion);

    if (!provisionLoadState) return undefined;

    const isDeploymentComplete =
        provisionLoadState === ApiStatus.Loaded && connectionLoadState === ApiStatus.Loaded;

    const whatsNextLinks = [
        {
            href: "https://learn.microsoft.com/en-us/azure/azure-sql/database/connect-query-ssms",
            label: locConstants.azureSqlDatabase.connectAndRunQuery,
        },
        {
            href: "https://learn.microsoft.com/en-us/azure/azure-sql/database/single-database-create-quickstart",
            label: locConstants.azureSqlDatabase.seedSampleData,
        },
        {
            href: "https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer",
            label: locConstants.azureSqlDatabase.monitorUsage,
        },
        {
            href: "https://learn.microsoft.com/en-us/azure/azure-sql/database/",
            label: locConstants.azureSqlDatabase.browseTutorials,
        },
    ];

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
                            <div className={classes.cardColumn} style={{ paddingRight: "5px" }}>
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
                {isDeploymentComplete && (
                    <div className={classes.docsCard}>
                        <Text className={classes.docsTitle}>
                            {locConstants.azureSqlDatabase.whatsNext}
                        </Text>
                        <div className={classes.docsActions}>
                            {whatsNextLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={classes.docsAction}>
                                    <span>{link.label}</span>
                                    <ArrowRight12Regular />
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
