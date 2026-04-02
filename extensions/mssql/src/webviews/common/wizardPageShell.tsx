/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import { ReactNode } from "react";
import { DialogPageShell, DialogPageShellContentWidth } from "./dialogPageShell";
import { locConstants } from "./locConstants";

const useStyles = makeStyles({
    headerEnd: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        fontWeight: tokens.fontWeightSemibold,
        alignSelf: "center",
        whiteSpace: "nowrap",
    },
    progressTrack: {
        width: "100%",
        height: "3px",
        backgroundColor: "var(--vscode-editorGroup-border)",
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        backgroundColor: "var(--vscode-button-background)",
        transitionDuration: tokens.durationNormal,
        transitionProperty: "width",
        transitionTimingFunction: tokens.curveEasyEase,
    },
    content: {
        width: "100%",
        minWidth: 0,
    },
});

export interface WizardPageShellProps {
    icon?: ReactNode;
    title: string;
    subtitle: ReactNode;
    currentStep: number;
    totalSteps: number;
    footerStart?: ReactNode;
    footerEnd?: ReactNode;
    maxContentWidth?: DialogPageShellContentWidth;
    children: ReactNode;
}

export const WizardPageShell = ({
    icon,
    title,
    subtitle,
    currentStep,
    totalSteps,
    footerStart,
    footerEnd,
    maxContentWidth = "medium",
    children,
}: WizardPageShellProps) => {
    const classes = useStyles();
    const progressPercent =
        totalSteps > 0 ? `${Math.min(100, Math.max(0, (currentStep / totalSteps) * 100))}%` : "0%";

    return (
        <DialogPageShell
            icon={icon}
            title={title}
            subtitle={subtitle}
            showHeaderDivider={false}
            maxContentWidth={maxContentWidth}
            headerEnd={
                <div className={classes.headerEnd}>
                    {locConstants.common.stepOf(currentStep, totalSteps)}
                </div>
            }
            headerBottom={
                <div className={classes.progressTrack}>
                    <div className={classes.progressFill} style={{ width: progressPercent }} />
                </div>
            }
            footerStart={footerStart}
            footerEnd={footerEnd}>
            <div className={classes.content}>{children}</div>
        </DialogPageShell>
    );
};
