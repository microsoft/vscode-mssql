/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { Card, makeStyles, tokens, Text } from "@fluentui/react-components";
import { DeploymentContext } from "./deploymentStateProvider";
import { DeploymentType } from "../../../sharedInterfaces/deployment";
import { locConstants } from "../../common/locConstants";
import { DialogPageShell } from "../../common/dialogPageShell";
import { DeploymentIcon } from "../../common/icons/deployment";
import { DockerIcon } from "../../common/icons/docker";
import { SqlDbInFabricIcon } from "../../common/icons/sqlDbInFabric";
import { DockerWizard } from "./dockerWizard";
import { FabricWizard } from "./fabricWizard";

const useStyles = makeStyles({
    cardRow: {
        display: "flex",
        flexDirection: "row",
        gap: "20px",
        justifyContent: "center",
        flexWrap: "wrap",
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
    cardIcon: {
        width: "32px",
        height: "32px",
    },
    cardIconSmall: {
        width: "32px",
        height: "32px",
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

    if (!context) {
        return undefined;
    }

    if (deploymentType === DeploymentType.LocalContainers) {
        return <DockerWizard onBack={() => setDeploymentType(undefined)} />;
    }

    if (deploymentType === DeploymentType.FabricProvisioning) {
        return <FabricWizard onBack={() => setDeploymentType(undefined)} />;
    }

    return (
        <DialogPageShell
            icon={<DeploymentIcon />}
            title={locConstants.deployment.deploymentHeader}
            subtitle={locConstants.deployment.deploymentDescription}
            maxContentWidth="wide">
            <div className={classes.cardRow}>
                <Card
                    className={classes.cardDiv}
                    onClick={() => setDeploymentType(DeploymentType.LocalContainers)}>
                    <DockerIcon
                        className={classes.cardIcon}
                        aria-label={locConstants.deployment.dockerSqlServerHeader}
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
                    <SqlDbInFabricIcon
                        className={classes.cardIconSmall}
                        aria-label={locConstants.deployment.fabricProvisioningHeader}
                    />
                    <Text className={classes.cardHeader}>
                        {locConstants.deployment.fabricProvisioningHeader}
                    </Text>
                    <Text className={classes.cardDescription}>
                        {locConstants.deployment.fabricProvisioningDescription}
                    </Text>
                </Card>
            </div>
        </DialogPageShell>
    );
};
