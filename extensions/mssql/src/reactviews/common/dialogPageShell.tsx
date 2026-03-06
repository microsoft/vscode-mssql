/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    MessageBar,
    MessageBarBody,
    Spinner,
    tokens,
} from "@fluentui/react-components";
import { cloneElement, isValidElement, ReactElement, ReactNode } from "react";

const headerIconSizePx = 24;

const useStyles = makeStyles({
    page: {
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-editor-foreground)",
    },
    scrollRegion: {
        flex: "1 1 auto",
        overflowY: "auto",
        overflowX: "hidden",
    },
    container: {
        width: "100%",
        margin: 0,
        padding: "28px 24px 32px",
        boxSizing: "border-box",
    },
    header: {
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "16px",
        alignItems: "center",
        paddingBottom: "20px",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
    },
    iconContainer: {
        width: `${headerIconSizePx}px`,
        height: `${headerIconSizePx}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--vscode-foreground)",
        overflow: "visible",
        flexShrink: 0,
    },
    headerText: {
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    title: {
        fontSize: tokens.fontSizeBase500,
        lineHeight: tokens.lineHeightBase500,
        fontWeight: tokens.fontWeightSemibold,
        color: "var(--vscode-foreground)",
    },
    subtitle: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        color: "var(--vscode-descriptionForeground)",
        wordBreak: "break-word",
    },
    messageStack: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        paddingTop: "20px",
    },
    loadingMessageBody: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        paddingTop: "24px",
    },
    footer: {
        flexShrink: 0,
        borderTop: "1px solid var(--vscode-editorGroup-border)",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        padding: "12px 24px",
    },
    footerInner: {
        width: "100%",
        margin: 0,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        boxSizing: "border-box",
    },
    footerGroup: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
});

export interface DialogPageShellProps {
    icon?: ReactNode;
    title?: string;
    subtitle?: ReactNode;
    errorMessage?: string;
    loadingMessage?: string;
    maxContentWidth?: string;
    footerStart?: ReactNode;
    footerEnd?: ReactNode;
    children?: ReactNode;
}

export const DialogPageShell = ({
    icon,
    title,
    subtitle,
    errorMessage,
    loadingMessage,
    maxContentWidth: _maxContentWidth,
    footerStart,
    footerEnd,
    children,
}: DialogPageShellProps) => {
    const styles = useStyles();
    const headerIcon =
        icon && isValidElement(icon)
            ? cloneElement(icon as ReactElement, {
                  width: headerIconSizePx,
                  height: headerIconSizePx,
              })
            : icon;

    return (
        <div className={styles.page} aria-label={title}>
            <div className={styles.scrollRegion}>
                <div className={styles.container}>
                    {(icon || title || subtitle) && (
                        <div className={styles.header}>
                            <div className={styles.iconContainer}>{headerIcon}</div>
                            <div className={styles.headerText}>
                                {title && <div className={styles.title}>{title}</div>}
                                {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
                            </div>
                        </div>
                    )}
                    {(errorMessage || loadingMessage) && (
                        <div className={styles.messageStack}>
                            {errorMessage && (
                                <MessageBar intent="error">
                                    <MessageBarBody>{errorMessage}</MessageBarBody>
                                </MessageBar>
                            )}
                            {loadingMessage && (
                                <MessageBar intent="info">
                                    <MessageBarBody>
                                        <div className={styles.loadingMessageBody}>
                                            <Spinner size="tiny" />
                                            <span>{loadingMessage}</span>
                                        </div>
                                    </MessageBarBody>
                                </MessageBar>
                            )}
                        </div>
                    )}
                    <div className={styles.content}>{children}</div>
                </div>
            </div>
            {(footerStart || footerEnd) && (
                <div className={styles.footer}>
                    <div className={styles.footerInner}>
                        <div className={styles.footerGroup}>{footerStart}</div>
                        <div className={styles.footerGroup}>{footerEnd}</div>
                    </div>
                </div>
            )}
        </div>
    );
};
