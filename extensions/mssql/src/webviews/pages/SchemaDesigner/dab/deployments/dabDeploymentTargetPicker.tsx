/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    DialogActions,
    makeStyles,
    mergeClasses,
    Text,
    tokens,
} from "@fluentui/react-components";
import { Warning16Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { DabLogoIcon } from "../../../../common/icons/dabLogo";
import { DockerIcon } from "../../../../common/icons/docker";
import { KeyCode } from "../../../../common/keys";
import { DabDialogContent, DabDialogTitle } from "./dabDialogLayout";
import { useDabContext } from "../dabContext";

const useStyles = makeStyles({
    /**
     * Centres the cards in the frame's height. The shared centred variant is
     * not used because it also centres text, and a card reads from its left
     * edge.
     */
    content: {
        justifyContent: "center",
    },
    // Mirrors the deployment page's target cards so choosing where to run DAB
    // looks like choosing where to create a database.
    cardRow: {
        display: "grid",
        // Fixed at two columns so the targets always sit beside each other
        // rather than wrapping into a stack on a narrower surface.
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "16px",
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
        minHeight: "200px",
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
        color: tokens.colorNeutralForeground2,
        textAlign: "left",
    },
    cardDisabled: {
        cursor: "not-allowed",
        opacity: 0.6,
        boxShadow: "none",
        ":hover": {
            transform: "none",
            boxShadow: "none",
            border: `1px solid ${tokens.colorNeutralStroke2}`,
        },
    },
    cardBlockedReason: {
        display: "flex",
        alignItems: "flex-start",
        gap: "6px",
        marginTop: "4px",
    },
    warningIcon: {
        color: tokens.colorStatusWarningForeground1,
        flexShrink: 0,
        marginTop: "3px",
    },
    cardBlockedText: {
        fontSize: "12px",
        lineHeight: "18px",
        color: tokens.colorStatusWarningForeground1,
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
    const { dabTargetSupport } = useDabContext();

    // The CLI leads: it works with every connection the container does and with
    // Windows Authentication besides, so it is the one that always applies.
    const targets = [
        {
            target: Dab.DabDeploymentTarget.DabCli,
            title: locConstants.schemaDesigner.deploymentTargetDabCli,
            description: locConstants.schemaDesigner.deploymentTargetDabCliDescription,
            icon: <DabLogoIcon className={classes.cardIcon} role="img" aria-hidden />,
        },
        {
            target: Dab.DabDeploymentTarget.Docker,
            title: locConstants.schemaDesigner.deploymentTargetDocker,
            description: locConstants.schemaDesigner.deploymentTargetDockerDescription,
            icon: <DockerIcon className={classes.cardIcon} role="img" aria-hidden />,
        },
    ];

    return (
        <>
            <DabDialogTitle>{locConstants.schemaDesigner.selectDeploymentTarget}</DabDialogTitle>
            <DabDialogContent className={classes.content}>
                <div className={classes.cardRow}>
                    {targets.map((target) => {
                        const support = dabTargetSupport[target.target];
                        const isSupported = support?.isSupported !== false;
                        const select = () => isSupported && onSelectTarget(target.target);

                        return (
                            <Card
                                key={target.target}
                                className={mergeClasses(
                                    classes.cardDiv,
                                    !isSupported && classes.cardDisabled,
                                )}
                                onClick={select}
                                onKeyDown={(event) => {
                                    if (
                                        event.code === KeyCode.Enter ||
                                        event.code === KeyCode.Space
                                    ) {
                                        event.preventDefault();
                                        select();
                                    }
                                }}
                                tabIndex={isSupported ? 0 : -1}
                                aria-disabled={!isSupported}
                                role="button">
                                <div className={classes.iconBadge}>{target.icon}</div>
                                <div className={classes.cardContent}>
                                    <Text className={classes.cardHeader}>{target.title}</Text>
                                    <Text className={classes.cardDescription}>
                                        {target.description}
                                    </Text>
                                    {!isSupported && support?.reason && (
                                        <div className={classes.cardBlockedReason}>
                                            <Warning16Regular className={classes.warningIcon} />
                                            <Text className={classes.cardBlockedText}>
                                                {support.reason}
                                            </Text>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        );
                    })}
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
