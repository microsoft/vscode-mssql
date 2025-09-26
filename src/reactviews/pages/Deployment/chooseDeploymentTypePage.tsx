/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Card, makeStyles, tokens, Text } from "@fluentui/react-components";
import { DeploymentContext } from "./deploymentStateProvider";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { FabricProvisioningInfoPage } from "./FabricProvisioning/fabricProvisioningInfoPage";
import { LocalContainersInfoPage } from "./LocalContainers/localContainersInfoPage";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        minWidth: "750px",
        minHeight: "fit-content",
    },
    cardRow: {
        display: "flex",
        flexDirection: "row",
        gap: "20px",
    },
    itemDiv: {
        position: "relative",
        overflow: "auto",
        display: "flex",
        flexDirection: "row",
        height: "fit-content",
        padding: "10px",
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
    dockerIcon: {
        width: "75px",
        height: "75px",
        marginRight: "10px",
    },
    sqlInFabricIcon: {
        width: "65px",
        height: "65px",
        marginRight: "10px",
    },
    subtitleDiv: {
        fontSize: "14px",
        alignItems: "unset",
        textAlign: "left",
        fontWeight: 400,
        paddingLeft: "70px",
        paddingBottom: "50px",
    },
    outerHeaderDiv: {
        display: "flex",
        flexDirection: "row",
        gap: "20px",
        alignItems: "center",
        justifyContent: "flex-start",
        minWidth: "750px",
        minHeight: "fit-content",
        top: 0,
        left: 0,
        paddingTop: "50px",
        paddingLeft: "70px",
        paddingBottom: "15px",
    },
    titleDiv: {
        fontWeight: 500,
        fontSize: "24px",
        display: "flex",
        alignItems: "center",
    },
    headerIcon: {
        width: "58px",
        height: "58px",
    },
    cardDiv: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "20px",
        gap: "5px",
        width: "400px",
        marginTop: "5px",
    },
    cardHeader: {
        fontWeight: 400,
        fontSize: "18px",
        padding: "5px",
        marginTop: "5px",
    },
    cardDescription: {
        fontWeight: 400,
        fontSize: "14px",
        padding: "5px",
        color: tokens.colorNeutralForeground4,
    },
});

export const ChooseDeploymentTypePage: React.FC = () => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const [deploymentType, setDeploymentType] = useState<DeploymentType>();

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!context) {
        return undefined;
    }

    const getDeploymentStartPage = () => {
        if (deploymentType === DeploymentType.LocalContainers) {
            return <LocalContainersInfoPage />;
        } else if (deploymentType === DeploymentType.FabricProvisioning) {
            return <FabricProvisioningInfoPage />;
        }
        return null;
    };

    return deploymentType !== undefined ? (
        getDeploymentStartPage()
    ) : (
        <div>
            <div className={classes.outerHeaderDiv}>
                <img className={classes.headerIcon} src={deploymentIcon()} />
                <Text className={classes.titleDiv}>{locConstants.deployment.deploymentHeader}</Text>
            </div>
            <Text className={classes.subtitleDiv}>
                {locConstants.deployment.deploymentDescription}
            </Text>

            <div className={classes.outerDiv}>
                <div className={classes.cardRow}>
                    <Card
                        className={classes.cardDiv}
                        onClick={() => setDeploymentType(DeploymentType.LocalContainers)}>
                        <img
                            className={classes.dockerIcon}
                            src={dockerIcon()}
                            alt={locConstants.deployment.dockerSqlServerHeader}
                        />
                        <Text className={classes.cardHeader}>
                            {locConstants.deployment.dockerSqlServerHeader}
                        </Text>
                        <Text className={classes.cardDescription}>
                            {locConstants.deployment.dockerSqlServerDescription}
                        </Text>
                    </Card>
                    <Card
                        className={classes.cardDiv}
                        onClick={() => setDeploymentType(DeploymentType.FabricProvisioning)}>
                        <img
                            className={classes.sqlInFabricIcon}
                            src={sqlDbInFabricIcon()}
                            alt={locConstants.deployment.fabricProvisioningHeader}
                        />
                        <Text className={classes.cardHeader}>
                            {locConstants.deployment.fabricProvisioningHeader}
                        </Text>
                        <Text className={classes.cardDescription}>
                            {locConstants.deployment.fabricProvisioningDescription}
                        </Text>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export const deploymentIcon = () => {
    return require(`../../media/database.svg`);
};

export const dockerIcon = () => {
    return require(`../../media/docker.svg`);
};

export const sqlDbInFabricIcon = () => {
    return require(`../../media/sqlDbInFabric.svg`);
};
