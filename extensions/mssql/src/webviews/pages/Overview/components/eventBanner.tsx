/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Text, makeStyles } from "@fluentui/react-components";
import { Dismiss12Filled } from "@fluentui/react-icons";
import React, { useState } from "react";

import { ChangelogEvent } from "../../../../sharedInterfaces/changelog";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const useStyles = makeStyles({
    bannerContainer: {
        position: "relative",
        borderRadius: "8px",
        maxHeight: "200px",
        overflowY: "auto",
        overflowX: "hidden",
        backgroundColor: "transparent",
        flexShrink: 0,
    },
    banner: {
        position: "relative",
        padding: "15px",
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        gap: "24px",
        width: "100%",
        boxSizing: "border-box",
        backgroundColor: "transparent",
        "@media (max-width: 900px)": {
            gridTemplateColumns: "1fr",
        },
        "::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            backgroundColor: "var(--vscode-button-background)",
            opacity: 0.1,
            zIndex: 0,
            pointerEvents: "none",
        },
    },
    bannerTitle: {
        fontSize: "14px",
        fontWeight: 600,
        color: "var(--vscode-editor-foreground)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        zIndex: 1,
    },
    bannerDismiss: {
        position: "absolute",
        top: "8px",
        right: "8px",
        minWidth: 0,
        zIndex: 1,
    },
    bannerDescription: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        justifyContent: "center",
        position: "relative",
        zIndex: 1,
    },
    codeSnippet: {
        display: "inline-flex",
        alignItems: "center",
        minHeight: "18px",
        padding: "0 4px",
        borderRadius: "4px",
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--vscode-editor-font-size)",
        color: "var(--vscode-symbolIcon-classForeground)",
    },
});

const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" });
const monthDayFmt = new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
});
const fullFmt = new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
});

/** Parses as UTC noon so the calendar date is right regardless of the viewer's timezone. */
function eventDate(date: string | undefined): Date | undefined {
    if (!date) {
        return undefined;
    }

    return new Date(`${date}T12:00:00Z`);
}

function isEventOver(eventData: ChangelogEvent): boolean {
    if (!eventData) {
        return false;
    }

    const expiresAt = new Date(
        `${eventData.endDate ?? eventData.date}T23:59:00${eventData.location?.timezone ?? "+00:00"}`,
    );

    if (isNaN(expiresAt.getTime())) {
        return false;
    }
    return new Date() >= expiresAt;
}

function formatEventDateRange(eventData: ChangelogEvent): string {
    const start = eventDate(eventData.date)!;
    const end = eventDate(eventData.endDate);

    if (!end || start.getTime() === end.getTime()) {
        return fullFmt.format(start);
    }

    if (start.getUTCFullYear() === end.getUTCFullYear()) {
        if (start.getUTCMonth() === end.getUTCMonth()) {
            return `${monthFmt.format(start)} ${start.getUTCDate()} - ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
        } else {
            return `${monthDayFmt.format(start)} - ${fullFmt.format(end)}`;
        }
    } else {
        return `${fullFmt.format(start)} - ${fullFmt.format(end)}`;
    }
}

export const EventBanner = () => {
    const classes = useStyles();
    const { openLink } = useOverviewActions();
    const event = useOverviewSelector((state) => state.changelog?.event);
    const [isDismissed, setIsDismissed] = useState(false);

    if (isDismissed || !event || isEventOver(event)) {
        return null;
    }

    const renderDescriptionWithSnippets = (text: string, snippets: string[]): React.ReactNode[] => {
        // Matches `{n}` placeholders such as "{0}"; the capture group keeps them in the result.
        const parts = text.split(/(\{\d+\})/g);

        return parts.map((part, idx) => {
            // Matches a part that is exactly one placeholder, e.g. "{1}", capturing its index.
            const match = /^\{(\d+)\}$/.exec(part);

            if (match) {
                const snippet = snippets[Number(match[1])];
                if (snippet !== undefined) {
                    return (
                        <span key={idx} className={classes.codeSnippet}>
                            {snippet}
                        </span>
                    );
                }
            }

            return <React.Fragment key={idx}>{part}</React.Fragment>;
        });
    };

    return (
        <div className={classes.bannerContainer}>
            <div className={classes.banner}>
                <div className={classes.bannerTitle}>
                    <Text
                        size={600}
                        weight="bold"
                        style={{
                            backgroundImage:
                                "linear-gradient(to right in oklab, var(--vscode-button-hoverBackground, var(--vscode-contrastBorder)) 0%, var(--vscode-button-background, var(--vscode-editor-background)) 100%)",
                            backgroundClip: "text",
                            WebkitBackgroundClip: "text",
                            color: "transparent",
                        }}>
                        {event.mainTitle}
                    </Text>
                    <Text
                        size={300}
                        weight="semibold"
                        style={{
                            marginTop: "5px",
                            whiteSpace: "pre-line",
                        }}>
                        {event.secondaryTitle}
                    </Text>
                    <Text size={200} weight="regular" style={{ marginTop: "5px" }}>
                        {`${formatEventDateRange(event)} | ${event.location.name}`}
                    </Text>
                    <Button
                        style={{
                            marginTop: "10px",
                            width: "100px",
                        }}
                        onClick={() => openLink(event.actionButton.url)}
                        appearance="primary">
                        {event.actionButton.text}
                    </Button>
                </div>
                <div className={classes.bannerDescription}>
                    {event.description.map((line, idx) => (
                        <Text key={idx} style={{ whiteSpace: "pre-line" }}>
                            {renderDescriptionWithSnippets(line, event.codeSnippets)}
                        </Text>
                    ))}
                </div>
                <Button
                    appearance="transparent"
                    icon={<Dismiss12Filled />}
                    className={classes.bannerDismiss}
                    aria-label={locConstants.common.dismiss}
                    onClick={() => setIsDismissed(true)}
                />
            </div>
        </div>
    );
};
