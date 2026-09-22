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
    // DialogBody is a 3-column grid with an 8px gap, which is what confined the bands to a
    // subset of the columns. Stacking the regions removes the placement entirely.
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
    // Monospace so the technologies read as a spec line rather than a sentence.
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
    /** Shown in the header band, beside the close button. */
    title: ReactNode;
    /** Sits left of the title, naming what kind of thing the dialog is about. */
    icon?: ReactNode;
    /** Second line under the title, for the specifics behind it. */
    subtitle?: ReactNode;
    /** Closing from the header's own button; the surrounding Dialog owns the open state. */
    onDismiss: () => void;
    /** Footer buttons, in reading order. */
    actions: ReactNode;
    children: ReactNode;
    /** Sizing for the surface. The shell sets no width, since each dialog needs its own. */
    className?: string;
    /** Applied alongside the content band, for a dialog that scrolls its own region. */
    contentClassName?: string;
}

/**
 * A dialog with banded header and footer regions: the title and close button on one ground, the
 * actions on another, and the content between them.
 *
 * Shared rather than restyled per dialog because the bands are what make two dialogs opened from
 * the same page read as the same thing -- which they had already stopped doing.
 */
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
