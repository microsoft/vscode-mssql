/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, makeStyles, tokens, Text } from "@fluentui/react-components";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { locConstants } from "../../common/locConstants";
import { DockerIcon } from "../../common/icons/docker";
import { SqlDbInFabricIcon } from "../../common/icons/sqlDbInFabric";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        minWidth: "750px",
        minHeight: "fit-content",
    },
    cardRow: {
        display: "flex",
        flexDirection: "row",
        gap: "16px",
        width: "100%",
        justifyContent: "center",
        alignItems: "stretch",
        flexWrap: "wrap",
    },
    cardDiv: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: "22px 24px",
        gap: "14px",
        width: "360px",
        minHeight: "220px",
        borderRadius: "18px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: tokens.shadow4,
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
}

export const ChooseDeploymentTypePage: React.FC<ChooseDeploymentTypePageProps> = ({
    selectedDeploymentType,
    onDeploymentTypeChange,
}) => {
    const classes = useStyles();
    return (
        <div className={classes.outerDiv}>
            <div className={classes.cardRow}>
                <Card
                    className={`${classes.cardDiv} ${
                        selectedDeploymentType === DeploymentType.LocalContainers
                            ? classes.selectedCard
                            : ""
                    }`}
                    onClick={() => onDeploymentTypeChange(DeploymentType.LocalContainers)}>
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
                    className={`${classes.cardDiv} ${
                        selectedDeploymentType === DeploymentType.FabricProvisioning
                            ? classes.selectedCard
                            : ""
                    }`}
                    onClick={() => onDeploymentTypeChange(DeploymentType.FabricProvisioning)}>
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
            </div>
        </div>
    );
};
