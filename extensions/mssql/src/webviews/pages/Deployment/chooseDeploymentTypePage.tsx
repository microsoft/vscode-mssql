/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, makeStyles, mergeClasses, tokens, Text } from "@fluentui/react-components";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { locConstants } from "../../common/locConstants";
import { DockerIcon } from "../../common/icons/docker";
import { SqlDbInFabricIcon } from "../../common/icons/sqlDbInFabric";
import { AzureSqlDatabaseIcon } from "../../common/icons/azureSqlDatabase";
import { KeyCode } from "../../common/keys";
import azureSqlContainerIcon from "../../media/azureSqlContainer.svg";
import { SqlMigrationIcon } from "../../common/icons/sqlMigration";
import { useId } from "react";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        minWidth: 0,
        minHeight: "fit-content",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "100%",
        maxWidth: "732px",
        minWidth: 0,
    },
    sectionHeading: {
        margin: 0,
    },
    cardRow: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 360px))",
        justifyContent: "start",
        gap: "12px",
        width: "100%",
        alignItems: "stretch",
    },
    cardDiv: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: "22px 24px",
        gap: "14px",
        width: "100%",
        maxWidth: "360px",
        minHeight: "220px",
        borderRadius: "18px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: tokens.shadow4,
        boxSizing: "border-box",
        justifySelf: "center",
        cursor: "pointer",
        transitionProperty: "transform, box-shadow, border-color",
        transitionDuration: tokens.durationNormal,
        transitionTimingFunction: tokens.curveEasyEase,
        ":hover": {
            transform: "translateY(-2px)",
            boxShadow: tokens.shadow8,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
        },
    },
    iconBadge: {
        width: "56px",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "14px",
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent)",
        color: "var(--vscode-focusBorder)",
        flexShrink: 0,
    },
    dockerIcon: {
        width: "32px",
        height: "32px",
    },
    sqlInFabricIcon: {
        width: "32px",
        height: "32px",
    },
    azureSqlIcon: {
        width: "32px",
        height: "32px",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "8px",
        width: "100%",
    },
    cardHeader: {
        fontWeight: 600,
        fontSize: "18px",
        lineHeight: "24px",
        letterSpacing: "0",
        color: tokens.colorNeutralForeground1,
    },
    cardDescription: {
        fontWeight: 400,
        fontSize: "14px",
        lineHeight: "22px",
        letterSpacing: "0",
        color: tokens.colorNeutralForeground3,
        textAlign: "left",
    },
    selectedCard: {
        border: "1px solid var(--vscode-focusBorder)",
        boxShadow: `0 0 0 1px var(--vscode-focusBorder), ${tokens.shadow8}`,
    },
});

interface ChooseDeploymentTypePageProps {
    selectedDeploymentType?: DeploymentType;
    onDeploymentTypeChange: (deploymentType: DeploymentType) => void;
    onAzureSqlContainerSelected: () => void;
    onLocalToCloudSelected: () => void;
}

export const ChooseDeploymentTypePage: React.FC<ChooseDeploymentTypePageProps> = ({
    selectedDeploymentType,
    onDeploymentTypeChange,
    onAzureSqlContainerSelected,
    onLocalToCloudSelected,
}) => {
    const classes = useStyles();
    const id = useId();
    return (
        <div className={classes.outerDiv}>
            <section className={classes.section} aria-labelledby={`${id}-local`}>
                <Text
                    as="h2"
                    id={`${id}-local`}
                    size={500}
                    weight="semibold"
                    className={classes.sectionHeading}>
                    {locConstants.deployment.localProvisioning}
                </Text>
                <div className={classes.cardRow}>
                    <Card
                        className={mergeClasses(
                            classes.cardDiv,
                            selectedDeploymentType === DeploymentType.LocalContainers
                                ? classes.selectedCard
                                : undefined,
                        )}
                        onClick={() => onDeploymentTypeChange(DeploymentType.LocalContainers)}
                        onKeyDown={(event) => {
                            if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
                                event.preventDefault();
                                onDeploymentTypeChange(DeploymentType.LocalContainers);
                            }
                        }}
                        tabIndex={0}
                        role="button">
                        <div className={classes.iconBadge}>
                            <DockerIcon
                                className={classes.dockerIcon}
                                role="img"
                                aria-label={locConstants.deployment.dockerSqlServerHeader}
                            />
                        </div>
                        <div className={classes.content}>
                            <Text className={classes.cardHeader}>
                                {locConstants.deployment.dockerSqlServerHeader}
                            </Text>
                            <Text className={classes.cardDescription}>
                                {locConstants.deployment.dockerSqlServerDescription}
                            </Text>
                        </div>
                    </Card>
                    <Card
                        className={classes.cardDiv}
                        onClick={onAzureSqlContainerSelected}
                        onKeyDown={(event) => {
                            if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
                                event.preventDefault();
                                onAzureSqlContainerSelected();
                            }
                        }}
                        tabIndex={0}
                        role="button">
                        <div className={classes.iconBadge}>
                            <img
                                src={azureSqlContainerIcon}
                                className={classes.azureSqlIcon}
                                alt=""
                            />
                        </div>
                        <div className={classes.content}>
                            <Text className={classes.cardHeader}>
                                {locConstants.azureSqlDatabase.developerContainerPreview}
                            </Text>
                            <Text className={classes.cardDescription}>
                                {locConstants.azureSqlDatabase.localContainerDescription}
                            </Text>
                        </div>
                    </Card>
                </div>
            </section>
            <section className={classes.section} aria-labelledby={`${id}-remote`}>
                <Text
                    as="h2"
                    id={`${id}-remote`}
                    size={500}
                    weight="semibold"
                    className={classes.sectionHeading}>
                    {locConstants.deployment.remoteProvisioning}
                </Text>
                <div className={classes.cardRow}>
                    <Card
                        className={mergeClasses(
                            classes.cardDiv,
                            selectedDeploymentType === DeploymentType.FabricProvisioning
                                ? classes.selectedCard
                                : undefined,
                        )}
                        onClick={() => onDeploymentTypeChange(DeploymentType.FabricProvisioning)}
                        onKeyDown={(event) => {
                            if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
                                event.preventDefault();
                                onDeploymentTypeChange(DeploymentType.FabricProvisioning);
                            }
                        }}
                        tabIndex={0}
                        role="button">
                        <div className={classes.iconBadge}>
                            <SqlDbInFabricIcon
                                className={classes.sqlInFabricIcon}
                                role="img"
                                aria-label={locConstants.deployment.fabricProvisioningHeader}
                            />
                        </div>
                        <div className={classes.content}>
                            <Text className={classes.cardHeader}>
                                {locConstants.deployment.fabricProvisioningHeader}
                            </Text>
                            <Text className={classes.cardDescription}>
                                {locConstants.deployment.fabricProvisioningDescription}
                            </Text>
                        </div>
                    </Card>
                    <Card
                        className={mergeClasses(
                            classes.cardDiv,
                            selectedDeploymentType === DeploymentType.AzureSqlDatabase
                                ? classes.selectedCard
                                : undefined,
                        )}
                        onClick={() => onDeploymentTypeChange(DeploymentType.AzureSqlDatabase)}
                        onKeyDown={(event) => {
                            if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
                                event.preventDefault();
                                onDeploymentTypeChange(DeploymentType.AzureSqlDatabase);
                            }
                        }}
                        tabIndex={0}
                        role="button">
                        <div className={classes.iconBadge}>
                            <AzureSqlDatabaseIcon
                                className={classes.azureSqlIcon}
                                role="img"
                                aria-label={locConstants.azureSqlDatabase.azureSqlDatabaseHeader}
                            />
                        </div>
                        <div className={classes.content}>
                            <Text className={classes.cardHeader}>
                                {locConstants.azureSqlDatabase.azureSqlDatabaseHeader}
                            </Text>
                            <Text className={classes.cardDescription}>
                                {locConstants.azureSqlDatabase.azureSqlDatabaseDescription}
                            </Text>
                        </div>
                    </Card>
                </div>
            </section>
            <section className={classes.section} aria-labelledby={`${id}-deployment`}>
                <Text
                    as="h2"
                    id={`${id}-deployment`}
                    size={500}
                    weight="semibold"
                    className={classes.sectionHeading}>
                    {locConstants.deployment.deploymentSection}
                </Text>
                <div className={classes.cardRow}>
                    <Card
                        className={classes.cardDiv}
                        onClick={onLocalToCloudSelected}
                        onKeyDown={(event) => {
                            if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
                                event.preventDefault();
                                onLocalToCloudSelected();
                            }
                        }}
                        tabIndex={0}
                        role="button">
                        <div className={classes.iconBadge}>
                            <SqlMigrationIcon className={classes.azureSqlIcon} aria-hidden="true" />
                        </div>
                        <div className={classes.content}>
                            <Text className={classes.cardHeader}>
                                {locConstants.azureSqlDatabase.deployLocalDatabase}
                            </Text>
                            <Text className={classes.cardDescription}>
                                {locConstants.azureSqlDatabase.deployLocalDatabaseDescription}
                            </Text>
                        </div>
                    </Card>
                </div>
            </section>
        </div>
    );
};
