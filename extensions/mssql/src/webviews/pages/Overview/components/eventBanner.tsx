/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Text, makeStyles } from "@fluentui/react-components";
import {
    ArrowRight16Regular,
    CalendarLtr16Regular,
    Checkmark16Regular,
    Copy16Regular,
    Dismiss12Filled,
    Location16Regular,
} from "@fluentui/react-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { ChangelogEvent } from "../../../../sharedInterfaces/changelog";
import { OverviewTelemetryEvent } from "../../../../sharedInterfaces/overview";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";

const COPY_FEEDBACK_MS = 2000;

const ACCENT = "var(--vscode-button-background)";

const useStyles = makeStyles({
    banner: {
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        columnGap: "32px",
        rowGap: "16px",
        padding: "20px 48px 20px 24px",
        borderRadius: "4px",
        border: "1px solid var(--vscode-contrastBorder, transparent)",
        backgroundColor: `color-mix(in srgb, ${ACCENT} 10%, transparent)`,
        "@media (max-width: 900px)": {
            gridTemplateColumns: "minmax(0, 1fr)",
            alignItems: "start",
        },
    },
    identity: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    title: {
        fontSize: "30px",
        lineHeight: "32px",
        fontWeight: 700,
        // The button color is tuned as a fill behind text, so it is too dark as text on dark
        // themes. Link color is tuned by each theme to read on the editor background.
        color: "var(--vscode-textLink-foreground)",
    },
    subtitle: {
        fontSize: "14px",
        lineHeight: "20px",
        fontWeight: 600,
        whiteSpace: "pre-line",
        color: "var(--vscode-foreground)",
    },
    meta: {
        display: "flex",
        flexWrap: "wrap",
        columnGap: "16px",
        rowGap: "4px",
        marginTop: "4px",
    },
    metaItem: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "13px",
        color: "var(--vscode-foreground)",
    },
    description: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        lineHeight: "20px",
        color: "var(--vscode-foreground)",
    },
    codeSnippet: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        margin: "0 2px",
        padding: "0 6px",
        minHeight: "20px",
        verticalAlign: "baseline",
        borderRadius: "2px",
        border: "none",
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--vscode-editor-font-size)",
        fontWeight: 600,
        color: "var(--vscode-symbolIcon-classForeground)",
        cursor: "pointer",
        ":hover": {
            textDecoration: "underline",
        },
        ":focus-visible": {
            outline: "1px solid var(--vscode-focusBorder)",
            outlineOffset: "1px",
        },
    },
    cta: {
        "@media (max-width: 900px)": {
            justifySelf: "start",
        },
    },
    dismiss: {
        position: "absolute",
        top: "8px",
        right: "8px",
        minWidth: 0,
    },
    srOnly: {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: "0",
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
    const { openLink, sendTelemetry } = useOverviewActions();
    const event = useOverviewSelector((state) => state.changelog?.event);
    const [isDismissed, setIsDismissed] = useState(false);
    const [isCodeCopied, setIsCodeCopied] = useState(false);
    const copyResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const isVisible = !isDismissed && !!event && !isEventOver(event);
    const eventId = event?.id;

    useEffect(() => () => clearTimeout(copyResetRef.current), []);

    // One impression per page load, so click-through can be measured against it.
    useEffect(() => {
        if (isVisible && eventId) {
            sendTelemetry(OverviewTelemetryEvent.EventBannerShown, eventId);
        }
    }, [isVisible, eventId, sendTelemetry]);

    const copyCode = useCallback(
        (code: string) => {
            sendTelemetry(OverviewTelemetryEvent.EventBannerCodeCopied, eventId);
            void navigator.clipboard.writeText(code).then(() => {
                setIsCodeCopied(true);
                clearTimeout(copyResetRef.current);
                copyResetRef.current = setTimeout(() => setIsCodeCopied(false), COPY_FEEDBACK_MS);
            });
        },
        [eventId, sendTelemetry],
    );

    if (!isVisible) {
        return null;
    }

    const register = () => {
        sendTelemetry(OverviewTelemetryEvent.EventBannerRegisterClicked, eventId);
        openLink(event.actionButton.url);
    };

    const dismiss = () => {
        sendTelemetry(OverviewTelemetryEvent.EventBannerDismissed, eventId);
        setIsDismissed(true);
    };

    const renderDescriptionWithSnippets = (text: string, snippets: string[]): React.ReactNode[] => {
        // Matches `{n}` placeholders such as "{0}"; the capture group keeps them in the result.
        const parts = text.split(/(\{\d+\})/g);

        return parts.map((part, idx) => {
            // Matches a part that is exactly one placeholder, e.g. "{1}", capturing its index.
            const match = /^\{(\d+)\}$/.exec(part);

            if (match) {
                const snippet = snippets[Number(match[1])];
                if (snippet !== undefined) {
                    const label = locConstants.overview.copyDiscountCode(snippet);
                    return (
                        <button
                            key={idx}
                            type="button"
                            className={classes.codeSnippet}
                            title={label}
                            aria-label={label}
                            onClick={() => copyCode(snippet)}>
                            {snippet}
                            {isCodeCopied ? <Checkmark16Regular /> : <Copy16Regular />}
                        </button>
                    );
                }
            }

            return <React.Fragment key={idx}>{part}</React.Fragment>;
        });
    };

    return (
        <section className={classes.banner} aria-label={event.mainTitle}>
            <div className={classes.identity}>
                <Text className={classes.title}>{event.mainTitle}</Text>
                <Text className={classes.subtitle}>{event.secondaryTitle}</Text>
                <div className={classes.meta}>
                    <span className={classes.metaItem} title={locConstants.overview.eventDates}>
                        <CalendarLtr16Regular aria-hidden />
                        {formatEventDateRange(event)}
                    </span>
                    <span className={classes.metaItem} title={locConstants.overview.eventLocation}>
                        <Location16Regular aria-hidden />
                        {event.location.name}
                    </span>
                </div>
            </div>
            <div className={classes.description}>
                {event.description.map((line, idx) => (
                    <Text key={idx} style={{ whiteSpace: "pre-line" }}>
                        {renderDescriptionWithSnippets(line, event.codeSnippets)}
                    </Text>
                ))}
            </div>
            <Button
                className={classes.cta}
                appearance="primary"
                icon={<ArrowRight16Regular />}
                iconPosition="after"
                onClick={register}>
                {event.actionButton.text}
            </Button>
            <Button
                appearance="transparent"
                icon={<Dismiss12Filled />}
                className={classes.dismiss}
                aria-label={locConstants.common.dismiss}
                onClick={dismiss}
            />
            <span className={classes.srOnly} role="status" aria-live="polite">
                {isCodeCopied ? locConstants.overview.discountCodeCopied : ""}
            </span>
        </section>
    );
};
