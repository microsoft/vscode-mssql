/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, Spinner, Text } from "@fluentui/react-components";
import {
    Checkmark12Regular,
    ChevronRight12Regular,
    ErrorCircle12Regular,
} from "@fluentui/react-icons";
import { useEffect, useRef } from "react";
import { LoadingLogEntry } from "../../sharedInterfaces/webview";
import { ErrorMessageDetails } from "./errorMessageDetails";

const useStyles = makeStyles({
    root: {
        minHeight: "160px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        overflow: "hidden",
        color: "var(--vscode-editor-foreground)",
    },
    spinner: {
        marginBottom: "12px",
        flexShrink: 0,
    },
    logScroll: {
        width: "100%",
        maxWidth: "420px",
        height: "160px",
        minHeight: 0,
        flexShrink: 0,
        overflowY: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: "var(--vscode-scrollbarSlider-background) transparent",
    },
    logRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "4px 0",
        lineHeight: "18px",
    },
    errorLogRow: {
        alignItems: "flex-start",
    },
    icon: {
        width: "14px",
        minWidth: "14px",
        height: "14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    activeIcon: {
        color: "var(--vscode-progressBar-background)",
    },
    doneIcon: {
        color: "var(--vscode-descriptionForeground)",
    },
    text: {
        minWidth: 0,
        color: "var(--vscode-descriptionForeground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    activeText: {
        color: "var(--vscode-editor-foreground)",
    },
    errorRow: {
        color: "var(--vscode-errorForeground)",
    },
});

export interface LoadingLogProps {
    messages: LoadingLogEntry[];
    minHeight?: string;
}

export function LoadingLog({ messages, minHeight }: LoadingLogProps) {
    const classes = useStyles();
    const scrollRef = useRef<HTMLDivElement | null>(undefined as unknown as HTMLDivElement | null);
    const visibleMessages = messages;
    const activeIndex = visibleMessages.length - 1;
    const hasTerminalError = visibleMessages[activeIndex]?.kind === "error";

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [visibleMessages.length]);

    return (
        <div className={classes.root} style={{ minHeight }}>
            {!hasTerminalError && <Spinner size="small" className={classes.spinner} />}
            <div className={classes.logScroll} ref={scrollRef} role="log" aria-live="polite">
                {visibleMessages.map((entry, index) => {
                    const isError = entry.kind === "error";
                    const isActive = index === activeIndex && !isError;

                    return (
                        <div
                            className={mergeClasses(
                                classes.logRow,
                                isError ? classes.errorLogRow : undefined,
                            )}
                            key={`${entry.message}-${index}`}>
                            <span
                                className={mergeClasses(
                                    classes.icon,
                                    isError
                                        ? classes.errorRow
                                        : isActive
                                          ? classes.activeIcon
                                          : classes.doneIcon,
                                )}>
                                {isError ? (
                                    <ErrorCircle12Regular />
                                ) : isActive ? (
                                    <ChevronRight12Regular />
                                ) : (
                                    <Checkmark12Regular />
                                )}
                            </span>
                            {isError ? (
                                <ErrorMessageDetails message={entry.message} />
                            ) : (
                                <Text
                                    className={mergeClasses(
                                        classes.text,
                                        isActive ? classes.activeText : undefined,
                                    )}>
                                    {entry.message}
                                </Text>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
