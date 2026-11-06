/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DialogActions,
    Field,
    Input,
    makeStyles,
    mergeClasses,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import { Info16Regular, Warning16Regular } from "@fluentui/react-icons";
import debounce from "lodash/debounce";
import { useEffect, useMemo, useRef, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { DabLogoIcon } from "../../../../common/icons/dabLogo";
import { DockerIcon } from "../../../../common/icons/docker";
import { KeyCode } from "../../../../common/keys";
import { DabDialogContent, DabDialogTitle } from "./dabDialogLayout";
import { useDabContext } from "../dabContext";

const useStyles = makeStyles({
    content: {
        gap: "24px",
    },
    /** Shared by the target group and the port field so the two read as one form. */
    sectionLabel: {
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground1,
        paddingBottom: "4px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    options: {
        display: "grid",
        // Fixed at two columns so the targets always sit beside each other
        // rather than wrapping into a stack on a narrower surface.
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "16px",
        width: "100%",
        alignItems: "stretch",
    },
    option: {
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: "16px",
        // Room on the right for the radio mark in the corner.
        padding: "20px 48px 20px 20px",
        borderRadius: tokens.borderRadiusXLarge,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        boxSizing: "border-box",
        cursor: "pointer",
        textAlign: "left",
        outlineOffset: "2px",
        transitionProperty: "border-color, background-color, box-shadow",
        transitionDuration: tokens.durationFaster,
        transitionTimingFunction: tokens.curveEasyEase,
        ":hover": {
            border: `1px solid ${tokens.colorNeutralStroke1Hover}`,
            backgroundColor: tokens.colorNeutralBackground2Hover,
        },
    },
    optionSelected: {
        // A second ring drawn as a shadow thickens the border without
        // shifting the content.
        border: "1px solid var(--vscode-focusBorder)",
        boxShadow: "0 0 0 1px var(--vscode-focusBorder)",
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 8%, transparent)",
        ":hover": {
            border: "1px solid var(--vscode-focusBorder)",
            backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent)",
        },
    },
    optionDisabled: {
        cursor: "not-allowed",
        opacity: 0.6,
        ":hover": {
            border: `1px solid ${tokens.colorNeutralStroke2}`,
            backgroundColor: tokens.colorNeutralBackground2,
        },
    },
    /** The radio mark: a ring in the corner, filled in the middle once chosen. */
    radio: {
        position: "absolute",
        top: "20px",
        right: "20px",
        width: "18px",
        height: "18px",
        borderRadius: "50%",
        border: `1px solid ${tokens.colorNeutralStrokeAccessible}`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    radioSelected: {
        border: "1px solid var(--vscode-focusBorder)",
        "::after": {
            content: '""',
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            backgroundColor: "var(--vscode-focusBorder)",
        },
    },
    iconTile: {
        width: "56px",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: tokens.borderRadiusXLarge,
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent)",
        flexShrink: 0,
    },
    optionIcon: {
        width: "36px",
        height: "36px",
    },
    optionText: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minWidth: 0,
    },
    optionTitle: {
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
    },
    optionDescription: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground2,
    },
    note: {
        display: "flex",
        alignItems: "flex-start",
        gap: "6px",
        marginTop: "4px",
    },
    noteIcon: {
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
        marginTop: "1px",
    },
    noteText: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground3,
    },
    warningIcon: {
        color: tokens.colorStatusWarningForeground1,
        flexShrink: 0,
        marginTop: "1px",
    },
    warningText: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorStatusWarningForeground1,
    },
    portField: {
        width: "160px",
    },
});

interface DabDeploymentSetupProps {
    onDeploy: (target: Dab.DabDeploymentTarget, port: number) => void;
    onCancel: () => void;
}

/**
 * The first deployment of a database: pick where DAB runs and the port, then
 * deploy. The port starts at the first free one and the name is generated.
 */
export const DabDeploymentSetup = ({ onDeploy, onCancel }: DabDeploymentSetupProps) => {
    const classes = useStyles();
    const { dabTargetSupport, dabConfig, checkDabDeploymentPort } = useDabContext();

    // The CLI leads: it works with every connection the container does and with
    // Windows Authentication besides, so it is the one that always applies.
    const targets = [
        {
            target: Dab.DabDeploymentTarget.DabCli,
            title: locConstants.schemaDesigner.deploymentTargetDabCli,
            description: locConstants.schemaDesigner.deploymentTargetDabCliDescription,
            icon: <DabLogoIcon className={classes.optionIcon} role="img" aria-hidden />,
        },
        {
            target: Dab.DabDeploymentTarget.Docker,
            title: locConstants.schemaDesigner.deploymentTargetDocker,
            description: locConstants.schemaDesigner.deploymentTargetDockerDescription,
            note: locConstants.schemaDesigner.dockerDesktopRequirement,
            icon: <DockerIcon className={classes.optionIcon} role="img" aria-hidden />,
        },
    ];
    const isTargetSupported = (target: Dab.DabDeploymentTarget) =>
        dabTargetSupport[target]?.isSupported !== false;

    const [selectedTarget, setSelectedTarget] = useState<Dab.DabDeploymentTarget | undefined>(
        () => targets.find((target) => isTargetSupported(target.target))?.target,
    );
    const hasApiTypes = (dabConfig?.apiTypes.length ?? 0) > 0;

    const [port, setPort] = useState("");
    const [portError, setPortError] = useState<string | undefined>();
    const [isCheckingPort, setIsCheckingPort] = useState(true);
    const portCheckIdRef = useRef(0);

    // Starts from the first free port, so the common case needs no typing.
    useEffect(() => {
        const checkId = ++portCheckIdRef.current;
        void checkDabDeploymentPort().then((result) => {
            if (checkId !== portCheckIdRef.current) {
                return;
            }
            setPort(result.port?.toString() ?? Dab.DAB_DEFAULT_PORT.toString());
            setPortError(result.isAvailable ? undefined : result.error);
            setIsCheckingPort(false);
        });
    }, []);

    const debouncedPortCheck = useMemo(
        () =>
            debounce((portNumber: number) => {
                const checkId = ++portCheckIdRef.current;
                void checkDabDeploymentPort(portNumber).then((result) => {
                    if (checkId !== portCheckIdRef.current) {
                        return;
                    }
                    setPortError(result.isAvailable ? undefined : result.error);
                    setIsCheckingPort(false);
                });
            }, 300),
        [checkDabDeploymentPort],
    );

    useEffect(() => () => debouncedPortCheck.cancel(), [debouncedPortCheck]);

    const handlePortChange = (value: string) => {
        setPort(value);
        const portNumber = Number(value);
        if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
            debouncedPortCheck.cancel();
            // Drop any answer still in flight for an earlier value.
            portCheckIdRef.current++;
            setPortError(locConstants.schemaDesigner.portInvalid);
            setIsCheckingPort(false);
            return;
        }

        setPortError(undefined);
        setIsCheckingPort(true);
        debouncedPortCheck(portNumber);
    };

    const canDeploy =
        !!selectedTarget && hasApiTypes && !isCheckingPort && !portError && port !== "";

    return (
        <>
            <DabDialogTitle>{locConstants.schemaDesigner.deployDataApiBuilder}</DabDialogTitle>
            <DabDialogContent className={classes.content}>
                <div className={classes.section}>
                    <Text className={classes.sectionLabel} id="dab-deployment-target-label">
                        {locConstants.schemaDesigner.deploymentTarget}
                    </Text>
                    <div
                        className={classes.options}
                        role="radiogroup"
                        aria-labelledby="dab-deployment-target-label">
                        {targets.map((target) => {
                            const support = dabTargetSupport[target.target];
                            const isSupported = isTargetSupported(target.target);
                            const isSelected = selectedTarget === target.target;
                            const select = () => isSupported && setSelectedTarget(target.target);

                            return (
                                <div
                                    key={target.target}
                                    className={mergeClasses(
                                        classes.option,
                                        isSelected && classes.optionSelected,
                                        !isSupported && classes.optionDisabled,
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
                                    aria-checked={isSelected}
                                    role="radio">
                                    <div className={classes.iconTile}>{target.icon}</div>
                                    <div className={classes.optionText}>
                                        <Text className={classes.optionTitle}>{target.title}</Text>
                                        <Text className={classes.optionDescription}>
                                            {target.description}
                                        </Text>
                                        {target.note && (
                                            <div className={classes.note}>
                                                <Info16Regular className={classes.noteIcon} />
                                                <Text className={classes.noteText}>
                                                    {target.note}
                                                </Text>
                                            </div>
                                        )}
                                        {!isSupported && support?.reason && (
                                            <div className={classes.note}>
                                                <Warning16Regular className={classes.warningIcon} />
                                                <Text className={classes.warningText}>
                                                    {support.reason}
                                                </Text>
                                            </div>
                                        )}
                                    </div>
                                    <span
                                        className={mergeClasses(
                                            classes.radio,
                                            isSelected && classes.radioSelected,
                                        )}
                                        aria-hidden
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                <Field
                    className={classes.portField}
                    label={{
                        children: locConstants.schemaDesigner.port,
                        className: classes.sectionLabel,
                    }}
                    validationState={portError ? "error" : undefined}
                    validationMessage={portError}>
                    <Input
                        type="number"
                        value={port}
                        disabled={port === "" && isCheckingPort}
                        contentAfter={isCheckingPort ? <Spinner size="extra-tiny" /> : undefined}
                        onChange={(_, data) => handlePortChange(data.value)}
                    />
                </Field>

                {!hasApiTypes && (
                    <div className={classes.note}>
                        <Warning16Regular className={classes.warningIcon} />
                        <Text className={classes.warningText}>
                            {locConstants.schemaDesigner.atLeastOneApiTypeRequired}
                        </Text>
                    </div>
                )}
            </DabDialogContent>
            <DialogActions>
                <Button appearance="secondary" onClick={onCancel}>
                    {locConstants.common.cancel}
                </Button>
                <Button
                    appearance="primary"
                    disabled={!canDeploy}
                    onClick={() => selectedTarget && onDeploy(selectedTarget, Number(port))}>
                    {locConstants.schemaDesigner.deploy}
                </Button>
            </DialogActions>
        </>
    );
};
