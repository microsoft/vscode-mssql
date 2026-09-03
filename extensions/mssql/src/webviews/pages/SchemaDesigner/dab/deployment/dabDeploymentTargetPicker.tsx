/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    makeStyles,
    Text,
    tokens,
} from "@fluentui/react-components";
import { Box20Regular, Rocket20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    description: {
        color: tokens.colorNeutralForeground2,
    },
    targetCard: {
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px",
        borderRadius: "6px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        textAlign: "left",
        width: "100%",
        cursor: "pointer",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground2Hover,
        },
    },
    targetIcon: {
        color: tokens.colorNeutralForeground2,
        marginTop: "2px",
    },
    targetText: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },
    targetTitle: {
        fontWeight: 600,
    },
    targetDescription: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
});

interface DabDeploymentTargetPickerProps {
    onSelectTarget: (target: Dab.DabDeploymentTarget) => void;
    onBack: () => void;
    onCancel: () => void;
}

/**
 * Asks where the deployment should run. Only local Docker is available today;
 * the picker exists so further targets slot in without reshaping the flow.
 */
export const DabDeploymentTargetPicker = ({
    onSelectTarget,
    onBack,
    onCancel,
}: DabDeploymentTargetPickerProps) => {
    const classes = useStyles();

    const targets = [
        {
            target: Dab.DabDeploymentTarget.Docker,
            Icon: Box20Regular,
            title: locConstants.schemaDesigner.deploymentTargetDocker,
            description: locConstants.schemaDesigner.deploymentTargetDockerDescription,
        },
        {
            target: Dab.DabDeploymentTarget.DabCli,
            Icon: Rocket20Regular,
            title: locConstants.schemaDesigner.deploymentTargetDabCli,
            description: locConstants.schemaDesigner.deploymentTargetDabCliDescription,
        },
    ];

    return (
        <>
            <DialogTitle>{locConstants.schemaDesigner.selectDeploymentTarget}</DialogTitle>
            <DialogContent className={classes.content}>
                <Text className={classes.description}>
                    {locConstants.schemaDesigner.selectDeploymentTargetDescription}
                </Text>
                {targets.map((target) => (
                    <div
                        key={target.target}
                        className={classes.targetCard}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectTarget(target.target)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelectTarget(target.target);
                            }
                        }}>
                        <target.Icon className={classes.targetIcon} />
                        <div className={classes.targetText}>
                            <Text className={classes.targetTitle}>{target.title}</Text>
                            <Text className={classes.targetDescription}>{target.description}</Text>
                        </div>
                    </div>
                ))}
            </DialogContent>
            <DialogActions>
                <Button appearance="secondary" onClick={onBack}>
                    {locConstants.schemaDesigner.backToDeployments}
                </Button>
                <Button appearance="secondary" onClick={onCancel}>
                    {locConstants.common.cancel}
                </Button>
            </DialogActions>
        </>
    );
};
