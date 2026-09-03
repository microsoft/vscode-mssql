/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, DialogActions, makeStyles, Text, tokens } from "@fluentui/react-components";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { DabLogoIcon } from "../../../../common/icons/dabLogo";
import { DockerIcon } from "../../../../common/icons/docker";
import { KeyCode } from "../../../../common/keys";
import { DabDialogContent, DabDialogTitle } from "./dabDialogLayout";

const useStyles = makeStyles({
    // Mirrors the deployment page's target cards so choosing where to run DAB
    // looks like choosing where to create a database.
    cardRow: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 300px))",
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
        padding: "22px 24px",
        gap: "14px",
        width: "100%",
        maxWidth: "300px",
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
    cardIcon: {
        width: "32px",
        height: "32px",
    },
    cardContent: {
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
        color: tokens.colorNeutralForeground1,
    },
    cardDescription: {
        fontWeight: 400,
        fontSize: "14px",
        lineHeight: "22px",
        color: tokens.colorNeutralForeground3,
        textAlign: "left",
    },
});

interface DabDeploymentTargetPickerProps {
    onSelectTarget: (target: Dab.DabDeploymentTarget) => void;
    onBack: () => void;
    onCancel: () => void;
}

/**
 * Asks where the deployment should run. Further targets slot into the card grid
 * without reshaping the flow.
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
            title: locConstants.schemaDesigner.deploymentTargetDocker,
            description: locConstants.schemaDesigner.deploymentTargetDockerDescription,
            icon: <DockerIcon className={classes.cardIcon} role="img" aria-hidden />,
        },
        {
            target: Dab.DabDeploymentTarget.DabCli,
            title: locConstants.schemaDesigner.deploymentTargetDabCli,
            description: locConstants.schemaDesigner.deploymentTargetDabCliDescription,
            icon: <DabLogoIcon className={classes.cardIcon} role="img" aria-hidden />,
        },
    ];

    return (
        <>
            <DabDialogTitle>{locConstants.schemaDesigner.selectDeploymentTarget}</DabDialogTitle>
            <DabDialogContent>
                <div className={classes.cardRow}>
                    {targets.map((target) => (
                        <Card
                            key={target.target}
                            className={classes.cardDiv}
                            onClick={() => onSelectTarget(target.target)}
                            onKeyDown={(event) => {
                                if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
                                    event.preventDefault();
                                    onSelectTarget(target.target);
                                }
                            }}
                            tabIndex={0}
                            role="button">
                            <div className={classes.iconBadge}>{target.icon}</div>
                            <div className={classes.cardContent}>
                                <Text className={classes.cardHeader}>{target.title}</Text>
                                <Text className={classes.cardDescription}>
                                    {target.description}
                                </Text>
                            </div>
                        </Card>
                    ))}
                </div>
            </DabDialogContent>
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
