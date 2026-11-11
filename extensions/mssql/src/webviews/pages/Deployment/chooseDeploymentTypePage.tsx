/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, makeStyles, mergeClasses, tokens, Text } from "@fluentui/react-components";
import { useId } from "react";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { locConstants } from "../../common/locConstants";
import { DockerIcon } from "../../common/icons/docker";
import { SqlDbInFabricIcon } from "../../common/icons/sqlDbInFabric";
import { AzureSqlDatabaseIcon } from "../../common/icons/azureSqlDatabase";
import { KeyCode } from "../../common/keys";
import azureSqlContainerIcon from "../../media/azureSqlContainer.svg";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        alignItems: "stretch",
        justifyContent: "center",
        width: "100%",
        minWidth: 0,
        minHeight: "fit-content",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        width: "100%",
        maxWidth: "672px",
        alignSelf: "center",
    },
    sectionHeading: {
        margin: 0,
    },
    cardRow: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 330px))",
        justifyContent: "center",
        gap: "12px",
        width: "100%",
        alignItems: "stretch",
    },
    cardDiv: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: "18px 20px",
        gap: "12px",
        width: "100%",
        maxWidth: "330px",
        minHeight: "200px",
        borderRadius: "16px",
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
        width: "48px",
        height: "48px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "12px",
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent)",
        color: "var(--vscode-focusBorder)",
        flexShrink: 0,
    },
    dockerIcon: {
        width: "28px",
        height: "28px",
    },
    sqlInFabricIcon: {
        width: "28px",
        height: "28px",
    },
    azureSqlIcon: {
        width: "28px",
        height: "28px",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "6px",
        width: "100%",
    },
    cardHeader: {
        fontWeight: 600,
        fontSize: "16px",
        lineHeight: "22px",
        letterSpacing: "0",
        color: tokens.colorNeutralForeground1,
    },
    cardDescription: {
        fontWeight: 400,
        fontSize: "13px",
        lineHeight: "20px",
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
    onLocalDatabaseDeploymentSelected: () => void;
}

export const ChooseDeploymentTypePage: React.FC<ChooseDeploymentTypePageProps> = ({
    selectedDeploymentType,
    onDeploymentTypeChange,
    onAzureSqlContainerSelected,
    onLocalDatabaseDeploymentSelected,
}) => {
    const classes = useStyles();
    const id = useId();
    return (
        <div className={classes.outerDiv}>
            <section className={classes.section} aria-labelledby={`${id}-local`}>
                <Text
                    as="h2"
                    id={`${id}-local`}
                    size={400}
                    weight="semibold"
                    className={classes.sectionHeading}>
                    {locConstants.deployment.localProvisioning}
                </Text>
                <div className={classes.cardRow}>
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
                                aria-label={locConstants.deployment.dockerSqlServerCardHeader}
                            />
                        </div>
                        <div className={classes.content}>
                            <Text className={classes.cardHeader}>
                                {locConstants.deployment.dockerSqlServerCardHeader}
                            </Text>
                            <Text className={classes.cardDescription}>
                                {locConstants.deployment.dockerSqlServerDescription}
                            </Text>
                        </div>
                    </Card>
                </div>
            </section>
            <section className={classes.section} aria-labelledby={`${id}-cloud`}>
                <Text
                    as="h2"
                    id={`${id}-cloud`}
                    size={400}
                    weight="semibold"
                    className={classes.sectionHeading}>
                    {locConstants.deployment.remoteProvisioning}
                </Text>
                <div className={classes.cardRow}>
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
                                aria-label={locConstants.deployment.azureSqlDatabaseCardHeader}
                            />
                        </div>
                        <div className={classes.content}>
                            <Text className={classes.cardHeader}>
                                {locConstants.deployment.azureSqlDatabaseCardHeader}
                            </Text>
                            <Text className={classes.cardDescription}>
                                {locConstants.azureSqlDatabase.azureSqlDatabaseDescription}
                            </Text>
                        </div>
                    </Card>
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
                                aria-label={locConstants.deployment.fabricProvisioningCardHeader}
                            />
                        </div>
                        <div className={classes.content}>
                            <Text className={classes.cardHeader}>
                                {locConstants.deployment.fabricProvisioningCardHeader}
                            </Text>
                            <Text className={classes.cardDescription}>
                                {locConstants.deployment.fabricProvisioningDescription}
                            </Text>
                        </div>
                    </Card>
                </div>
            </section>
            <section className={classes.section} aria-labelledby={`${id}-deploy`}>
                <Text
                    as="h2"
                    id={`${id}-deploy`}
                    size={400}
                    weight="semibold"
                    className={classes.sectionHeading}>
                    {locConstants.deployment.deployToCloud}
                </Text>
                <div className={classes.cardRow}>
                    <Card
                        className={classes.cardDiv}
                        onClick={onLocalDatabaseDeploymentSelected}
                        onKeyDown={(event) => {
                            if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
                                event.preventDefault();
                                onLocalDatabaseDeploymentSelected();
                            }
                        }}
                        tabIndex={0}
                        role="button">
                        <div className={classes.iconBadge}>
                            <AzureSqlDatabaseIcon
                                className={classes.azureSqlIcon}
                                role="img"
                                aria-label={locConstants.azureSqlDatabase.deployLocalDatabase}
                            />
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
