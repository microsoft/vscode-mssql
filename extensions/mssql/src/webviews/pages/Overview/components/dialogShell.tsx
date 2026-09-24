/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { ReactNode } from "react";

import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    // The header and footer bands run edge to edge, so the surface owns no padding of its own.
    surface: {
        padding: 0,
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: 0,
    },
    header: {
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        padding: "16px 24px",
        margin: 0,
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        columnGap: "12px",
        width: "100%",
    },
    identity: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        minWidth: 0,
    },
    icon: {
        display: "flex",
        flexShrink: 0,
        color: tokens.colorNeutralForeground2,
    },
    titles: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minWidth: 0,
    },
    subtitle: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground3,
    },
    headerTitle: {
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        color: tokens.colorNeutralForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    content: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        padding: "16px 24px",
        margin: 0,
        flexGrow: 1,
        minHeight: 0,
    },
    actions: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        columnGap: "12px",
        padding: "12px 24px",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderTop: "1px solid var(--vscode-editorGroup-border)",
    },
});

interface DialogShellProps {
    title: ReactNode;
    icon?: ReactNode;
    subtitle?: ReactNode;
    onDismiss: () => void;
    actions: ReactNode;
    children: ReactNode;
    className?: string;
    contentClassName?: string;
}

export const DialogShell = ({
    title,
    icon,
    subtitle,
    onDismiss,
    actions,
    children,
    className,
    contentClassName,
}: DialogShellProps) => {
    const classes = useStyles();

    return (
        <DialogSurface className={mergeClasses(classes.surface, className)}>
            <DialogBody className={classes.body}>
                <DialogTitle className={classes.header}>
                    <div className={classes.headerRow}>
                        <div className={classes.identity}>
                            {icon && <span className={classes.icon}>{icon}</span>}
                            <div className={classes.titles}>
                                <span className={classes.headerTitle}>{title}</span>
                                {subtitle && <span className={classes.subtitle}>{subtitle}</span>}
                            </div>
                        </div>
                        <Button
                            appearance="subtle"
                            aria-label={locConstants.common.close}
                            icon={<Dismiss24Regular />}
                            onClick={onDismiss}
                        />
                    </div>
                </DialogTitle>
                <DialogContent className={mergeClasses(classes.content, contentClassName)}>
                    {children}
                </DialogContent>
                <DialogActions className={classes.actions}>{actions}</DialogActions>
            </DialogBody>
        </DialogSurface>
    );
};
