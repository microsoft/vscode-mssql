/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, makeStyles, mergeClasses, Text } from "@fluentui/react-components";
import { Checkmark16Regular, Copy16Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { locConstants } from "./locConstants";

const useStyles = makeStyles({
    root: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        columnGap: "8px",
        rowGap: "6px",
        width: "100%",
        minWidth: 0,
    },
    title: {
        gridColumn: 1,
        minWidth: 0,
        fontWeight: 600,
        lineHeight: "20px",
    },
    message: {
        gridColumn: "1 / -1",
        minWidth: 0,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        lineHeight: "20px",
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
        paddingRight: "8px",
    },
    copyButton: {
        gridColumn: 2,
        gridRow: 1,
        flexShrink: 0,
        alignSelf: "start",
    },
    toggle: {
        gridColumn: "1 / -1",
        justifySelf: "start",
        fontSize: "12px",
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
            setCanExpand(messageElement.scrollHeight > messageElement.clientHeight);
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

    const copyLabel = copied ? locConstants.common.copied : locConstants.common.copy;

    const copyMessage = async () => {
        try {
            await navigator.clipboard.writeText(message);
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
        <div className={classes.root}>
            {title && (
                <Text className={classes.title} weight="semibold">
                    {title}
                </Text>
            )}
            <div
                ref={messageRef}
                className={mergeClasses(
                    classes.message,
                    expanded ? classes.expandedMessage : classes.collapsedMessage,
                )}
                tabIndex={expanded ? 0 : undefined}>
                {message}
            </div>
            <Button
                className={classes.copyButton}
                appearance="subtle"
                size="small"
                icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                title={copyLabel}
                aria-label={copyLabel}
                onClick={() => void copyMessage()}
            />
            {canExpand && (
                <Link
                    as="button"
                    className={classes.toggle}
                    onClick={() => setExpanded((current) => !current)}>
                    {expanded ? locConstants.common.collapse : locConstants.common.expand}
                </Link>
            )}
        </div>
    );
};
