/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { ReactNode } from "react";

const useStyles = makeStyles({
    page: {
        height: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-editor-foreground)",
    },
    content: {
        flex: "1 1 auto",
        width: "100%",
        maxWidth: "min(720px, 100%)",
        padding: "28px 24px 96px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        boxSizing: "border-box",
    },
    header: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    title: {
        fontSize: "20px",
        fontWeight: "600",
    },
    description: {
        fontSize: "14px",
        color: "var(--vscode-descriptionForeground)",
        lineHeight: "20px",
    },
    footer: {
        position: "sticky",
        bottom: 0,
        backgroundColor: "var(--vscode-editor-background)",
        borderTop: "1px solid var(--vscode-editorGroup-border)",
        padding: "12px 24px",
    },
    footerInner: {
        maxWidth: "min(720px, 100%)",
        margin: "0 auto",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "8px",
        boxSizing: "border-box",
    },
    footerGroup: {
        display: "flex",
        gap: "8px",
    },
});

export interface ObjectManagementDialogProps {
    title?: string;
    description?: string;
    errorMessage?: string;
    primaryLabel: string;
    cancelLabel: string;
    helpLabel?: string;
    scriptLabel?: string;
    primaryDisabled?: boolean;
    scriptDisabled?: boolean;
    onPrimary?: () => void | Promise<void>;
    onCancel?: () => void | Promise<void>;
    onHelp?: () => void | Promise<void>;
    onScript?: () => void | Promise<void>;
    children?: ReactNode;
}

export const ObjectManagementDialog = ({
    title,
    description,
    errorMessage,
    primaryLabel,
    cancelLabel,
    helpLabel,
    scriptLabel,
    primaryDisabled,
    scriptDisabled,
    onPrimary,
    onCancel,
    onHelp,
    onScript,
    children,
}: ObjectManagementDialogProps) => {
    const styles = useStyles();

    return (
        <div className={styles.page} aria-label={title}>
            <div className={styles.content}>
                <div className={styles.header}>
                    {title && <div className={styles.title}>{title}</div>}
                    {description && <div className={styles.description}>{description}</div>}
                </div>
                {errorMessage && (
                    <MessageBar intent={"error"}>
                        <MessageBarBody>{errorMessage}</MessageBarBody>
                    </MessageBar>
                )}
                {children}
            </div>
            <div className={styles.footer}>
                <div className={styles.footerInner}>
                    <div className={styles.footerGroup}>
                        {helpLabel && (
                            <Button
                                size="medium"
                                appearance="secondary"
                                disabled={!onHelp}
                                onClick={() => onHelp?.()}>
                                {helpLabel}
                            </Button>
                        )}
                        {scriptLabel && (
                            <Button
                                size="medium"
                                appearance="secondary"
                                disabled={!onScript || scriptDisabled}
                                onClick={() => onScript?.()}>
                                {scriptLabel}
                            </Button>
                        )}
                    </div>
                    <div className={styles.footerGroup}>
                        <Button size="medium" appearance="secondary" onClick={() => onCancel?.()}>
                            {cancelLabel}
                        </Button>
                        <Button
                            size="medium"
                            appearance="primary"
                            disabled={primaryDisabled}
                            onClick={() => onPrimary?.()}>
                            {primaryLabel}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
