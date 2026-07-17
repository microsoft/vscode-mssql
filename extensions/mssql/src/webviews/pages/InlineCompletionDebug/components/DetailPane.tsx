/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useState } from "react";
import {
    Button,
    Tab,
    TabList,
    Text,
    makeStyles,
    mergeClasses,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { CopyRegular } from "@fluentui/react-icons";
import { getEventModelLabel } from "../../../../sharedInterfaces/inlineCompletionAnalysis";
import { IcDetailSection } from "../../../../sharedInterfaces/completionsDebugRpc";
import { InlineCompletionDebugEvent } from "../../../../sharedInterfaces/inlineCompletionDebug";
import { getLatencyBucket } from "../../../../sharedInterfaces/latencyBuckets";
import {
    getPendingDetail,
    InlineCompletionDebugPendingDetail,
    useInlineCompletionDebugContext,
} from "../inlineCompletionDebugStateProvider";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        ...shorthands.borderTop("1px", "solid", "var(--vscode-panel-border)"),
    },
    tabHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px",
        ...shorthands.padding("0", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
        minHeight: "36px",
    },
    tabScroller: {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        overflowX: "auto",
        overflowY: "hidden",
    },
    tabList: {
        width: "max-content",
        minWidth: "max-content",
        "& [role='tab']": {
            flexShrink: 0,
            whiteSpace: "nowrap",
        },
    },
    content: {
        ...shorthands.flex(1),
        minHeight: 0,
        overflowY: "auto",
        ...shorthands.padding("16px"),
    },
    emptyState: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--vscode-descriptionForeground)",
    },
    summaryGrid: {
        display: "grid",
        gridTemplateColumns: "180px minmax(0, 1fr)",
        rowGap: "6px",
        columnGap: "16px",
        marginBottom: "18px",
    },
    summaryLabel: {
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase200,
        letterSpacing: "0.04em",
    },
    blockLabel: {
        marginBottom: "6px",
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase200,
        letterSpacing: "0.04em",
    },
    monoBlock: {
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        color: "var(--vscode-textPreformat-foreground)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: "1.45",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
        ...shorthands.padding("12px"),
        ...shorthands.margin(0),
    },
    keyValueGrid: {
        display: "grid",
        gridTemplateColumns: "max-content minmax(0, 1fr)",
        rowGap: "8px",
        columnGap: "16px",
        alignItems: "baseline",
    },
    telemetryLabel: {
        whiteSpace: "nowrap",
    },
    copyButton: {
        flexShrink: 0,
        height: "28px",
        minWidth: "auto",
        ...shorthands.padding("0", "10px"),
    },
    note: {
        marginBottom: "8px",
        color: "var(--vscode-descriptionForeground)",
    },
    // Section-lazy loading (thin-transport hosts): the skeleton keeps the
    // block's footprint so nothing shifts when the content lands.
    loadingBlock: {
        minHeight: "96px",
        color: "var(--vscode-descriptionForeground)",
    },
    loadingSummaryBlock: {
        minHeight: "260px",
        color: "var(--vscode-descriptionForeground)",
    },
});

type DetailTab =
    | "summary"
    | "system"
    | "user"
    | "raw"
    | "sanitized"
    | "schema"
    | "locals"
    | "telemetry";

/**
 * Sections each tab renders, tagged with the pendingDetail flag that says
 * whether that content is still host-side only (fetch it lazily then).
 */
const detailTabSections: Record<
    DetailTab,
    Array<{ section: IcDetailSection; flag: keyof InlineCompletionDebugPendingDetail }>
> = {
    summary: [
        { section: "summary", flag: "summary" },
        { section: "locals", flag: "locals" },
        { section: "sanitizedResponse", flag: "sanitizedResponse" },
    ],
    system: [{ section: "prompt", flag: "prompt" }],
    user: [{ section: "prompt", flag: "prompt" }],
    raw: [{ section: "rawResponse", flag: "rawResponse" }],
    sanitized: [
        { section: "sanitizedResponse", flag: "sanitizedResponse" },
        { section: "rawResponse", flag: "rawResponse" },
        { section: "locals", flag: "locals" },
    ],
    schema: [{ section: "schemaContext", flag: "schema" }],
    locals: [{ section: "locals", flag: "locals" }],
    telemetry: [{ section: "summary", flag: "summary" }],
};

export const InlineCompletionDebugDetailPane = ({
    event,
    onCopyEventPayload,
}: {
    event: InlineCompletionDebugEvent | undefined;
    onCopyEventPayload?: (
        event: InlineCompletionDebugEvent,
        kind: "systemPrompt" | "userPrompt" | "rawResponse" | "sanitizedResponse",
    ) => void;
}) => {
    const classes = useStyles();
    const { copyEventPayload, getEventDetail } = useInlineCompletionDebugContext();
    const [activeTab, setActiveTab] = useState<DetailTab>("summary");
    const [detailError, setDetailError] = useState<string | undefined>(undefined);
    const telemetryRows = useMemo(() => (event ? buildTelemetryRows(event) : []), [event]);

    // Section-lazy hydration: events projected from thin live rows carry
    // pendingDetail flags; fetch exactly the sections the active tab shows
    // and let the provider merge the content in (flags clear on merge).
    const pendingDetail = getPendingDetail(event);
    const eventId = event?.id;
    const neededSections = useMemo(() => {
        if (!eventId || !pendingDetail) {
            return [] as IcDetailSection[];
        }
        const needed = detailTabSections[activeTab]
            .filter((entry) => pendingDetail[entry.flag])
            .map((entry) => entry.section);
        return [...new Set(needed)];
    }, [eventId, pendingDetail, activeTab]);
    const neededSectionsKey = neededSections.join("|");

    useEffect(() => {
        if (!eventId || neededSections.length === 0) {
            return undefined;
        }
        let cancelled = false;
        setDetailError(undefined);
        void getEventDetail({ kind: "live" }, eventId, neededSections).then(
            (result) => {
                if (!cancelled && !result.found) {
                    setDetailError(
                        "Event detail is no longer available (dropped from the live ring).",
                    );
                }
            },
            () => {
                if (!cancelled) {
                    setDetailError("Couldn't load event detail — select the event again to retry.");
                }
            },
        );
        return () => {
            cancelled = true;
        };
        // neededSectionsKey stands in for the array identity.
    }, [eventId, activeTab, neededSectionsKey, getEventDetail]);

    if (!event) {
        return (
            <div className={classes.emptyState}>
                Select an event to inspect its prompt and response.
            </div>
        );
    }

    const sectionLoading = (flag: keyof InlineCompletionDebugPendingDetail): boolean =>
        !detailError && pendingDetail?.[flag] === true;
    const loadingBlock = (extraClass?: string) => (
        <pre className={mergeClasses(classes.monoBlock, extraClass ?? classes.loadingBlock)}>
            Loading …
        </pre>
    );

    const systemPrompt = event.promptMessages[0]?.content ?? "";
    const userPrompt = event.promptMessages[1]?.content ?? "";
    const sanitizedNote = describeSanitization(event);

    return (
        <div className={classes.root}>
            <div className={classes.tabHeader}>
                <div className={classes.tabScroller}>
                    <TabList
                        className={classes.tabList}
                        selectedValue={activeTab}
                        onTabSelect={(_, data) => setActiveTab(data.value as DetailTab)}>
                        <Tab value="summary">Summary</Tab>
                        <Tab value="system">System Prompt</Tab>
                        <Tab value="user">User Prompt</Tab>
                        <Tab value="raw">Raw Response</Tab>
                        <Tab value="sanitized">Sanitized</Tab>
                        <Tab value="schema">Schema Context</Tab>
                        <Tab value="locals">Locals Dump</Tab>
                        <Tab value="telemetry">Telemetry</Tab>
                    </TabList>
                </div>

                {activeTab === "system" ? (
                    <Button
                        className={classes.copyButton}
                        size="small"
                        icon={<CopyRegular />}
                        onClick={() =>
                            onCopyEventPayload
                                ? onCopyEventPayload(event, "systemPrompt")
                                : copyEventPayload(event.id, "systemPrompt")
                        }>
                        Copy
                    </Button>
                ) : activeTab === "user" ? (
                    <Button
                        className={classes.copyButton}
                        size="small"
                        icon={<CopyRegular />}
                        onClick={() =>
                            onCopyEventPayload
                                ? onCopyEventPayload(event, "userPrompt")
                                : copyEventPayload(event.id, "userPrompt")
                        }>
                        Copy
                    </Button>
                ) : activeTab === "raw" ? (
                    <Button
                        className={classes.copyButton}
                        size="small"
                        icon={<CopyRegular />}
                        onClick={() =>
                            onCopyEventPayload
                                ? onCopyEventPayload(event, "rawResponse")
                                : copyEventPayload(event.id, "rawResponse")
                        }>
                        Copy
                    </Button>
                ) : activeTab === "sanitized" ? (
                    <Button
                        className={classes.copyButton}
                        size="small"
                        icon={<CopyRegular />}
                        onClick={() =>
                            onCopyEventPayload
                                ? onCopyEventPayload(event, "sanitizedResponse")
                                : copyEventPayload(event.id, "sanitizedResponse")
                        }>
                        Copy
                    </Button>
                ) : null}
            </div>

            <div className={classes.content}>
                {detailError ? <Text className={classes.note}>{detailError}</Text> : null}
                {activeTab === "summary" ? (
                    <>
                        {sectionLoading("summary") ? (
                            loadingBlock(classes.loadingSummaryBlock)
                        ) : (
                            <div className={classes.summaryGrid}>
                                {summaryRow("Event", event.id, classes)}
                                {summaryRow(
                                    "Time",
                                    new Date(event.timestamp).toLocaleString(),
                                    classes,
                                )}
                                {summaryRow(
                                    "Document",
                                    `${event.documentFileName} | Ln ${event.line}, Col ${event.column}`,
                                    classes,
                                )}
                                {summaryRow(
                                    "Trigger",
                                    event.explicitFromUser ? "explicit" : "automatic",
                                    classes,
                                )}
                                {summaryRow(
                                    "Mode",
                                    `${
                                        event.completionCategory ??
                                        (event.intentMode ? "intent" : "continuation")
                                    } | intentMode=${event.intentMode}`,
                                    classes,
                                )}
                                {summaryRow("Model", formatEventModel(event), classes)}
                                {summaryRow("Result", event.result, classes)}
                                {summaryRow("Latency", formatLatency(event), classes)}
                                {summaryRow(
                                    "Tokens",
                                    `in=${formatTokenCount(event.inputTokens)} | out=${formatTokenCount(
                                        event.outputTokens,
                                    )}`,
                                    classes,
                                )}
                                {summaryRow(
                                    "LM Request",
                                    formatLanguageModelRequest(event),
                                    classes,
                                )}
                                {summaryRow(
                                    "Schema",
                                    `${event.schemaObjectCount} objs | system=${event.schemaSystemObjectCount} | fks=${event.schemaForeignKeyCount}`,
                                    classes,
                                )}
                            </div>
                        )}

                        <Text className={classes.blockLabel}>User text</Text>
                        {sectionLoading("locals") ? (
                            loadingBlock()
                        ) : (
                            <pre className={classes.monoBlock}>
                                {String(event.locals.linePrefix ?? "")}
                            </pre>
                        )}

                        <Text className={classes.blockLabel} style={{ marginTop: "14px" }}>
                            Sanitized response
                        </Text>
                        {sectionLoading("sanitizedResponse") ? (
                            loadingBlock()
                        ) : (
                            <pre className={classes.monoBlock}>
                                {event.sanitizedResponse ?? event.finalCompletionText ?? "--"}
                            </pre>
                        )}
                    </>
                ) : null}

                {activeTab === "system" ? (
                    sectionLoading("prompt") ? (
                        loadingBlock()
                    ) : (
                        <pre className={classes.monoBlock}>{systemPrompt || "--"}</pre>
                    )
                ) : null}
                {activeTab === "user" ? (
                    sectionLoading("prompt") ? (
                        loadingBlock()
                    ) : (
                        <pre className={classes.monoBlock}>{userPrompt || "--"}</pre>
                    )
                ) : null}
                {activeTab === "raw" ? (
                    sectionLoading("rawResponse") ? (
                        loadingBlock()
                    ) : (
                        <pre className={classes.monoBlock}>{event.rawResponse || "--"}</pre>
                    )
                ) : null}
                {activeTab === "sanitized" ? (
                    sectionLoading("sanitizedResponse") || sectionLoading("rawResponse") ? (
                        loadingBlock()
                    ) : (
                        <>
                            <Text className={classes.note}>{sanitizedNote}</Text>
                            <pre className={classes.monoBlock}>
                                {event.sanitizedResponse ?? event.finalCompletionText ?? "--"}
                            </pre>
                        </>
                    )
                ) : null}
                {activeTab === "schema" ? (
                    sectionLoading("schema") ? (
                        loadingBlock()
                    ) : (
                        <pre className={classes.monoBlock}>
                            {event.schemaContextFormatted ?? "--"}
                        </pre>
                    )
                ) : null}
                {activeTab === "locals" ? (
                    sectionLoading("locals") ? (
                        loadingBlock()
                    ) : (
                        <pre className={classes.monoBlock}>
                            {JSON.stringify(event.locals, undefined, 2)}
                        </pre>
                    )
                ) : null}
                {activeTab === "telemetry" ? (
                    sectionLoading("summary") ? (
                        loadingBlock()
                    ) : (
                        <div className={classes.keyValueGrid}>
                            {telemetryRows.map(([label, value]) => (
                                <React.Fragment key={label}>
                                    <Text
                                        className={mergeClasses(
                                            classes.summaryLabel,
                                            classes.telemetryLabel,
                                        )}>
                                        {label}
                                    </Text>
                                    <Text>{value}</Text>
                                </React.Fragment>
                            ))}
                        </div>
                    )
                ) : null}
            </div>
        </div>
    );
};

function summaryRow(label: string, value: string, classes: ReturnType<typeof useStyles>) {
    return (
        <React.Fragment key={label}>
            <Text className={classes.summaryLabel}>{label}</Text>
            <Text>{value}</Text>
        </React.Fragment>
    );
}

function describeSanitization(event: InlineCompletionDebugEvent): string {
    const steps: string[] = [];
    if (event.rawResponse.includes("```")) {
        steps.push("stripped fences");
    }
    const linePrefix = String(event.locals.linePrefix ?? "");
    if (
        linePrefix.trim().length >= 6 &&
        event.rawResponse.trimStart().toLowerCase().startsWith(linePrefix.trim().toLowerCase())
    ) {
        steps.push("removed echoed line prefix");
    }
    if (
        event.rawResponse &&
        event.sanitizedResponse &&
        event.rawResponse.trim() !== event.sanitizedResponse.trim()
    ) {
        steps.push("trimmed host-only text");
    }
    if (
        event.sanitizedResponse &&
        event.rawResponse &&
        event.sanitizedResponse.length < event.rawResponse.length
    ) {
        steps.push("truncated at completion limit");
    }
    return steps.length > 0 ? steps.join(" | ") : "No notable sanitization changes.";
}

function buildTelemetryRows(event: InlineCompletionDebugEvent): Array<[string, string]> {
    return [
        ["result", event.result],
        ["usedSchemaContext", String(event.usedSchemaContext)],
        ["fallbackWithoutMetadata", String(!event.usedSchemaContext)],
        ["schemaObjectCountBucket", bucketCount(event.schemaObjectCount)],
        ["schemaSystemObjectCountBucket", bucketCount(event.schemaSystemObjectCount)],
        ["schemaForeignKeyCountBucket", bucketCount(event.schemaForeignKeyCount)],
        ["modelFamily", event.modelFamily ?? "unknown"],
        ["triggerKind", event.triggerKind],
        ["latencyBucket", getLatencyBucket(event.latencyMs)],
        ["inferredSystemQuery", String(event.inferredSystemQuery)],
        [
            "completionCategory",
            event.completionCategory ?? (event.intentMode ? "intent" : "continuation"),
        ],
        ["intentMode", String(event.intentMode)],
    ];
}

function formatTokenCount(value: number | undefined): string {
    return value === undefined ? "unknown" : value.toLocaleString();
}

function formatLatency(event: InlineCompletionDebugEvent): string {
    if (event.result !== "pending") {
        return `${event.latencyMs.toLocaleString()} ms`;
    }

    return `${Math.max(0, Date.now() - event.timestamp).toLocaleString()} ms (pending)`;
}

function formatLanguageModelRequest(event: InlineCompletionDebugEvent): string {
    const sent = event.locals.languageModelRequestSent;
    if (typeof sent !== "boolean") {
        return "unknown";
    }

    if (sent) {
        return "sent";
    }

    const unsentInputTokens = event.locals.unsentInputTokens;
    return typeof unsentInputTokens === "number"
        ? `not sent | unsent input=${unsentInputTokens.toLocaleString()}`
        : "not sent";
}

function bucketCount(count: number): string {
    if (count === 0) {
        return "0";
    }
    if (count <= 5) {
        return "1-5";
    }
    if (count <= 10) {
        return "6-10";
    }
    if (count <= 20) {
        return "11-20";
    }
    return "20+";
}

function formatEventModel(event: InlineCompletionDebugEvent): string {
    if (event.modelVendor && event.modelId) {
        const familySuffix =
            event.modelFamily && event.modelFamily !== event.modelId
                ? `, family=${event.modelFamily}`
                : "";
        return `${event.modelVendor}/${event.modelId}${familySuffix}`;
    }
    return getEventModelLabel(event);
}
