/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, makeStyles, mergeClasses } from "@fluentui/react-components";
import { Checkmark16Regular, Copy16Regular, ErrorCircle16Filled } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { locConstants } from "./locConstants";

const errorColor = "var(--vscode-errorForeground)";

const useStyles = makeStyles({
    root: {
        display: "grid",
        gridTemplateColumns: "16px minmax(0, 1fr) auto",
        columnGap: "10px",
        rowGap: "4px",
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        padding: "10px 8px 10px 12px",
        border: `1px solid color-mix(in srgb, ${errorColor} 45%, transparent)`,
        borderRadius: "4px",
        backgroundColor: `color-mix(in srgb, ${errorColor} 10%, var(--vscode-editor-background))`,
        color: "var(--vscode-foreground)",
        fontSize: "13px",
        lineHeight: "20px",
    },
    icon: {
        gridColumn: 1,
        gridRow: 1,
        width: "16px",
        height: "16px",
        marginTop: "2px",
        color: errorColor,
    },
    title: {
        gridColumn: 2,
        gridRow: 1,
        minWidth: 0,
        fontWeight: 600,
    },
    copyButton: {
        gridColumn: 3,
        gridRow: 1,
        alignSelf: "start",
        minWidth: "24px",
        width: "24px",
        height: "24px",
        color: "var(--vscode-icon-foreground, var(--vscode-foreground))",
    },
    message: {
        gridColumn: "2 / 4",
        minWidth: 0,
        paddingRight: "8px",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    },
    untitledMessage: {
        gridColumn: 2,
        gridRow: 1,
    },
    collapsedMessage: {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
        overflow: "hidden",
    },
    expandedMessage: {
        maxHeight: "220px",
        overflowY: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: "var(--vscode-scrollbarSlider-background) transparent",
    },
    toggle: {
        gridColumn: 2,
        justifySelf: "start",
        fontSize: "12px",
        lineHeight: "18px",
    },
});

export interface ErrorMessageDetailsProps {
    message: string;
    title?: string;
}

export const ErrorMessageDetails = ({ message, title }: ErrorMessageDetailsProps) => {
    const classes = useStyles();
    const messageRef = useRef<HTMLDivElement | null>(undefined as unknown as HTMLDivElement | null);
    const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [expanded, setExpanded] = useState(false);
    const [canExpand, setCanExpand] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setExpanded(false);
        setCopied(false);
    }, [message]);

    useEffect(() => {
        if (expanded || !messageRef.current) {
            return;
        }

        const messageElement = messageRef.current;
        const measureOverflow = () => {
            setCanExpand(messageElement.scrollHeight > messageElement.clientHeight + 1);
        };
        const frame = requestAnimationFrame(measureOverflow);
        const resizeObserver = new ResizeObserver(measureOverflow);
        resizeObserver.observe(messageElement);

        return () => {
            cancelAnimationFrame(frame);
            resizeObserver.disconnect();
        };
    }, [expanded, message]);

    useEffect(
        () => () => {
            if (copyResetTimerRef.current) {
                clearTimeout(copyResetTimerRef.current);
            }
        },
        [],
    );

    const copyLabel = copied ? locConstants.common.copied : locConstants.common.copyErrorDetails;

    const copyMessage = async () => {
        try {
            await navigator.clipboard.writeText(title ? `${title}\n${message}` : message);
            setCopied(true);
            if (copyResetTimerRef.current) {
                clearTimeout(copyResetTimerRef.current);
            }
            copyResetTimerRef.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard access can be unavailable in restricted webview contexts.
        }
    };

    return (
        <div className={classes.root} role="alert">
            <ErrorCircle16Filled className={classes.icon} aria-hidden />
            {title && <div className={classes.title}>{title}</div>}
            <Button
                className={classes.copyButton}
                appearance="subtle"
                size="small"
                icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                title={copyLabel}
                aria-label={copyLabel}
                onClick={() => void copyMessage()}
            />
            <div
                ref={messageRef}
                className={mergeClasses(
                    classes.message,
                    !title && classes.untitledMessage,
                    expanded ? classes.expandedMessage : classes.collapsedMessage,
                )}
                tabIndex={expanded ? 0 : undefined}>
                {message}
            </div>
            {canExpand && (
                <Link
                    as="button"
                    className={classes.toggle}
                    aria-expanded={expanded}
                    onClick={() => setExpanded((current) => !current)}>
                    {expanded ? locConstants.common.showLess : locConstants.common.showMore}
                </Link>
            )}
        </div>
    );
};
