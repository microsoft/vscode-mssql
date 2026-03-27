/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode } from "react";
import { Card, makeStyles, mergeClasses, Spinner, tokens } from "@fluentui/react-components";
import { CheckmarkCircleFilled, Circle20Regular, DismissCircleFilled } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    outerDiv: {
        height: "fit-content",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        borderRadius: "0",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        boxShadow: "none",
        backgroundColor: tokens.colorNeutralBackground1,
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "8px 12px",
        width: "100%",
        boxSizing: "border-box",
    },
    leftHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
    },
    statusIcon: {
        fontSize: "24px",
        width: "24px",
        height: "24px",
        flexShrink: 0,
    },
    title: {
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
    },
    body: {
        padding: "0 12px 8px 44px",
        color: tokens.colorNeutralForeground3,
    },
});

export interface DeploymentStepCardProps {
    status: ApiStatus;
    title: ReactNode;
    children?: ReactNode;
    headerAction?: ReactNode;
    className?: string;
    bodyClassName?: string;
}

export const DeploymentStepCard: React.FC<DeploymentStepCardProps> = ({
    status,
    title,
    children,
    headerAction,
    className,
    bodyClassName,
}) => {
    const classes = useStyles();

    const getStatusIcon = () => {
        if (status === ApiStatus.NotStarted) {
            return (
                <Circle20Regular
                    className={classes.statusIcon}
                    style={{ color: tokens.colorNeutralStroke1Pressed }}
                />
            );
        }
        if (status === ApiStatus.Loaded) {
            return (
                <CheckmarkCircleFilled
                    className={classes.statusIcon}
                    style={{ color: tokens.colorPaletteGreenForeground1 }}
                />
            );
        }
        if (status === ApiStatus.Error) {
            return (
                <DismissCircleFilled
                    className={classes.statusIcon}
                    style={{ color: tokens.colorPaletteRedForeground1 }}
                />
            );
        }
        return <Spinner size="tiny" />;
    };

    return (
        <Card className={mergeClasses(classes.outerDiv, className)}>
            <div className={classes.header}>
                <div className={classes.leftHeader}>
                    {getStatusIcon()}
                    <span className={classes.title}>{title}</span>
                </div>
                {headerAction}
            </div>
            {children && (
                <div className={mergeClasses(classes.body, bodyClassName)}>{children}</div>
            )}
        </Card>
    );
};
