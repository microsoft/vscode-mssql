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

const contentWidthPresets = {
    medium: "720px",
    wide: "800px",
} as const;

type DialogPageShellContentPreset = keyof typeof contentWidthPresets;

export type DialogPageShellContentWidth = DialogPageShellContentPreset | number;

function resolveContentWidth(
    maxContentWidth: DialogPageShellContentWidth | undefined,
): string | undefined {
    if (maxContentWidth === undefined) {
        return undefined;
    }

    if (typeof maxContentWidth === "number") {
        return `${maxContentWidth}px`;
    }

    return contentWidthPresets[maxContentWidth];
}

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
        scrollbarGutter: "stable both-edges",
    },
    container: {
        width: "100%",
        margin: 0,
        padding: "16px 0 32px",
        boxSizing: "border-box",
    },
    header: {
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "16px",
        alignItems: "center",
        paddingBottom: "16px",
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
        gap: "2px",
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
        paddingTop: "16px",
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
        paddingTop: "20px",
    },
    footer: {
        flexShrink: 0,
        borderTop: "1px solid var(--vscode-editorGroup-border)",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        padding: "12px 0",
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
    headerEnd?: ReactNode;
    headerBottom?: ReactNode;
    errorMessage?: string;
    loadingMessage?: string;
    maxContentWidth?: DialogPageShellContentWidth;
    footerStart?: ReactNode;
    footerEnd?: ReactNode;
    children?: ReactNode;
}

export const DialogPageShell = ({
    icon,
    title,
    subtitle,
    headerEnd,
    headerBottom,
    errorMessage,
    loadingMessage,
    maxContentWidth,
    footerStart,
    footerEnd,
    children,
}: DialogPageShellProps) => {
    const styles = useStyles();
    const resolvedMaxContentWidth = resolveContentWidth(maxContentWidth);
    const contentWidthStyle = resolvedMaxContentWidth
        ? {
              width: "100%",
              maxWidth: resolvedMaxContentWidth,
              margin: "0 auto",
          }
        : { width: "100%" };
    const footerWidthStyle = resolvedMaxContentWidth
        ? {
              width: "100%",
              maxWidth: `calc(${resolvedMaxContentWidth} + 48px)`,
              margin: "0 auto",
          }
        : { width: "100%" };

    const headerIcon =
        icon && isValidElement(icon)
            ? cloneElement(icon as ReactElement, {
                  width: headerIconSizePx,
                  height: headerIconSizePx,
              })
            : icon;
    const hasHeaderIcon = headerIcon !== undefined && headerIcon !== null && headerIcon !== false;

    return (
        <div className={styles.page} aria-label={title}>
            <div className={styles.scrollRegion}>
                <div className={styles.container}>
                    {(icon || title || subtitle || headerEnd || headerBottom) && (
                        <div
                            className={styles.header}
                            style={{
                                ...contentWidthStyle,
                                gridTemplateColumns:
                                    hasHeaderIcon && headerEnd
                                        ? "auto minmax(0, 1fr) auto"
                                        : hasHeaderIcon
                                          ? "auto 1fr"
                                          : headerEnd
                                            ? "minmax(0, 1fr) auto"
                                            : "1fr",
                            }}>
                            {hasHeaderIcon && (
                                <div className={styles.iconContainer}>{headerIcon}</div>
                            )}
                            <div className={styles.headerText}>
                                {title && <div className={styles.title}>{title}</div>}
                                {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
                            </div>
                            {headerEnd}
                        </div>
                    )}
                    {headerBottom && <div style={contentWidthStyle}>{headerBottom}</div>}
                    {(errorMessage || loadingMessage) && (
                        <div className={styles.messageStack} style={contentWidthStyle}>
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
                    <div className={styles.content} style={contentWidthStyle}>
                        {children}
                    </div>
                </div>
            </div>
            {(footerStart || footerEnd) && (
                <div className={styles.footer}>
                    <div className={styles.footerInner} style={footerWidthStyle}>
                        <div className={styles.footerGroup}>{footerStart}</div>
                        <div className={styles.footerGroup}>{footerEnd}</div>
                    </div>
                </div>
            )}
        </div>
    );
};
