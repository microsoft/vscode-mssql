/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Caption1,
    makeStyles,
    MessageBar,
    MessageBarBody,
    MessageBarIntent,
    shorthands,
    Spinner,
    Subtitle2,
    Text,
    tokens,
} from "@fluentui/react-components";
import { ReactNode, useState } from "react";
import type {
    PreparedQueryStoreSettingsChange,
    QueryStoreCaptureMode,
    QueryStoreReadOnlyReason,
    QueryStoreSettings,
    QueryStoreSettingsBlocker,
    QueryStoreSettingsWarning,
    QueryStoreState,
} from "../../../sharedInterfaces/performance";
import {
    ApplyQueryStoreSettingsChangeRequest,
    GetQueryStoreSettingsRequest,
    OpenSqlScriptRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    PrepareQueryStoreSettingsChangeRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { SegmentedControl, SegmentedControlOption } from "../../common/segmentedControl";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import {
    QueryStoreSettingsForm,
    changeOf,
    formOf,
    intervalChoicesMinutes,
    keepDaysChoices,
    maxSizeChoicesMb,
    numberChoices,
    operationModeOf,
    storageUseOf,
} from "./performanceDashboardSettingsModel";
import { readStatusMessage } from "./performanceDashboardStatus";

const useStyles = makeStyles({
    card: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("14px"),
        ...shorthands.padding("16px", "20px"),
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
    },
    header: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        ...shorthands.gap("12px"),
    },
    heading: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("2px"),
    },
    headerActions: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
    },
    storage: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("6px"),
    },
    track: {
        position: "relative",
        height: "8px",
        ...shorthands.borderRadius("4px"),
        backgroundColor: tokens.colorNeutralBackground5,
    },
    fill: {
        height: "100%",
        ...shorthands.borderRadius("4px"),
        backgroundColor: tokens.colorBrandBackground,
    },
    marker: {
        position: "absolute",
        top: "-4px",
        width: "2px",
        height: "16px",
        backgroundColor: tokens.colorNeutralForeground3,
    },
    storageLabels: {
        display: "flex",
        justifyContent: "space-between",
    },
    used: {
        fontFamily: tokens.fontFamilyMonospace,
    },
    facts: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
        ...shorthands.overflow("hidden"),
    },
    fact: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("4px"),
        ...shorthands.padding("10px", "16px"),
        ...shorthands.borderRight("1px", "solid", "var(--vscode-panel-border)"),
    },
    rows: {
        display: "grid",
        gridTemplateColumns: "minmax(160px, 240px) 1fr",
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
    },
    rowLabel: {
        display: "flex",
        alignItems: "center",
        ...shorthands.padding("10px", "16px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    rowControl: {
        display: "flex",
        alignItems: "center",
        ...shorthands.padding("8px", "16px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    footer: {
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        ...shorthands.gap("12px"),
    },
    footerText: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("8px"),
    },
    actions: {
        display: "flex",
        ...shorthands.gap("8px"),
    },
    script: {
        ...shorthands.margin(0),
        ...shorthands.padding("12px"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        whiteSpace: "pre-wrap",
        overflowX: "auto",
    },
});

type Mode = "view" | "edit" | "review";

interface Notice {
    readonly intent: MessageBarIntent;
    readonly text: string;
}

const numberFormat = new Intl.NumberFormat();
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent" });

/**
 * The Query Store settings. When Query Store is on, it shows the storage and the configuration,
 * and "Change settings" opens the form. When Query Store is off, it shows the form. A change is
 * prepared, reviewed as T-SQL, and applied only when the user selects Apply.
 */
export const PerformanceDashboardQueryStoreSettings = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const [version, setVersion] = useState(0);
    const read = useExtensionRequest(GetQueryStoreSettingsRequest.type, undefined, [
        databaseName,
        version,
    ]);
    const [mode, setMode] = useState<Mode | undefined>(undefined);
    const [form, setForm] = useState<QueryStoreSettingsForm | undefined>(undefined);
    const [prepared, setPrepared] = useState<PreparedQueryStoreSettingsChange | undefined>(
        undefined,
    );
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<Notice | undefined>(undefined);

    const info = read.result && "data" in read.result ? read.result.data : undefined;
    const settings = info?.settings;

    const header = (actions?: ReactNode) => (
        <div className={classes.header}>
            <div className={classes.heading}>
                <Subtitle2>{text.queryStore}</Subtitle2>
                <Caption1 className={classes.secondary}>{text.queryStoreDescription}</Caption1>
            </div>
            <div className={classes.headerActions}>
                {settings && <StateBadge state={settings.actualState} />}
                {actions}
            </div>
        </div>
    );

    if (!settings || !info) {
        const unsupported = read.result?.status === "unsupported";
        const message = unsupported ? undefined : readStatusMessage(read);
        return (
            <div className={classes.card}>
                {header()}
                {unsupported ? (
                    <Caption1 className={classes.secondary}>{text.noQueryStoreSettings}</Caption1>
                ) : message ? (
                    <MessageBar intent={message.intent}>
                        <MessageBarBody>{message.text}</MessageBarBody>
                    </MessageBar>
                ) : (
                    <Spinner size="small" label={loc.common.loading} />
                )}
            </div>
        );
    }

    const currentMode: Mode = mode ?? (settings.actualState === "off" ? "edit" : "view");
    const currentForm = form ?? formOf(settings);
    const change = changeOf(currentForm, settings);
    const hasChange = Object.keys(change).length > 0;
    const canPrepare = hasChange && info.canAlter && info.canChange && !busy;

    const startEditing = () => {
        setNotice(undefined);
        setForm(formOf(settings));
        setMode("edit");
    };

    const cancelEditing = () => {
        setForm(undefined);
        setMode(undefined);
    };

    const prepare = async () => {
        setBusy(true);
        setNotice(undefined);
        try {
            const result = await extensionRpc.sendRequest(
                PrepareQueryStoreSettingsChangeRequest.type,
                change,
            );
            if ("data" in result && result.data) {
                setPrepared(result.data);
                setMode("review");
            } else {
                const message = readStatusMessage({ loading: false, result });
                setNotice(message ?? { intent: "error", text: text.readFailed(result.status) });
            }
        } catch (error) {
            setNotice({ intent: "error", text: text.readFailed(errorText(error)) });
        } finally {
            setBusy(false);
        }
    };

    const apply = async () => {
        if (!prepared) {
            return;
        }
        setBusy(true);
        setNotice(undefined);
        try {
            const result = await extensionRpc.sendRequest(
                ApplyQueryStoreSettingsChangeRequest.type,
                prepared,
            );
            if ("data" in result && result.data?.applied) {
                setNotice({ intent: "success", text: text.settingsChanged });
                setPrepared(undefined);
                setForm(undefined);
                setMode(undefined);
            } else if ("data" in result && result.data) {
                setNotice({
                    intent: "error",
                    text: result.data.blockers.map(blockerText).join(" "),
                });
                setMode("edit");
            } else {
                const message = readStatusMessage({ loading: false, result });
                setNotice(message ?? { intent: "error", text: text.readFailed(result.status) });
            }
            setVersion((value) => value + 1);
        } catch (error) {
            setNotice({ intent: "error", text: text.readFailed(errorText(error)) });
        } finally {
            setBusy(false);
        }
    };

    const noticeBar = notice && (
        <MessageBar intent={notice.intent}>
            <MessageBarBody>{notice.text}</MessageBarBody>
        </MessageBar>
    );

    if (currentMode === "review" && prepared) {
        return (
            <div className={classes.card}>
                {header()}
                {noticeBar}
                <Text weight="semibold">{text.reviewChange}</Text>
                {prepared.blockers.map((blocker) => (
                    <MessageBar key={blocker} intent="error">
                        <MessageBarBody>{blockerText(blocker)}</MessageBarBody>
                    </MessageBar>
                ))}
                {prepared.warnings.map((warning) => (
                    <MessageBar key={warning} intent="warning">
                        <MessageBarBody>{warningText(warning)}</MessageBarBody>
                    </MessageBar>
                ))}
                <pre className={classes.script}>{prepared.sql}</pre>
                <div className={classes.footer}>
                    <Caption1 className={classes.secondary}>{text.reviewDescription}</Caption1>
                    <div className={classes.actions}>
                        <Button onClick={() => setMode("edit")} disabled={busy}>
                            {loc.common.back}
                        </Button>
                        <Button
                            onClick={() =>
                                void extensionRpc.sendRequest(OpenSqlScriptRequest.type, {
                                    sql: prepared.sql,
                                })
                            }>
                            {text.openInQueryEditor}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={busy || prepared.blockers.length > 0}
                            onClick={() => void apply()}>
                            {busy ? <Spinner size="tiny" /> : loc.common.apply}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    if (currentMode === "edit") {
        return (
            <div className={classes.card}>
                {header()}
                {noticeBar}
                {!info.canChange && (
                    <MessageBar intent="info">
                        <MessageBarBody>{text.settingsNotChangeable}</MessageBarBody>
                    </MessageBar>
                )}
                <SettingsForm
                    settings={settings}
                    form={currentForm}
                    hasWaitStats={info.hasWaitStats}
                    onChange={setForm}
                />
                <div className={classes.footer}>
                    <div className={classes.footerText}>
                        <Caption1 className={classes.secondary}>{text.pickToChange}</Caption1>
                        <Caption1 className={classes.secondary}>
                            {info.canAlter ? text.needsAlterYouHaveIt : text.needsAlterYouDoNot}
                        </Caption1>
                    </div>
                    <div className={classes.actions}>
                        <Button onClick={cancelEditing} disabled={busy}>
                            {loc.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={!canPrepare}
                            onClick={() => void prepare()}>
                            {busy ? <Spinner size="tiny" /> : text.prepareForReview}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const cleanupPercent = storageUseOf(settings)?.cleanupPercent;
    return (
        <div className={classes.card}>
            {header(
                info.canChange && <Button onClick={startEditing}>{text.changeSettings}</Button>,
            )}
            {noticeBar}
            {settings.actualState === "readOnly" && settings.readOnlyReason && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        {text.queryStoreReadOnlyBecause(
                            readOnlyReasonText(settings.readOnlyReason),
                        )}
                    </MessageBarBody>
                </MessageBar>
            )}
            <StorageBar settings={settings} />
            <div className={classes.facts}>
                <Fact
                    label={text.mode}
                    value={
                        operationModeOf(settings) === "readOnly" ? text.readOnly : text.readWrite
                    }
                />
                <Fact label={text.capture} value={captureText(settings.captureMode)} />
                <Fact
                    label={text.keeps}
                    value={
                        settings.staleQueryThresholdDays !== undefined
                            ? text.days(numberFormat.format(settings.staleQueryThresholdDays))
                            : text.notAvailable
                    }
                />
                <Fact
                    label={text.interval}
                    value={
                        settings.intervalLengthMinutes !== undefined
                            ? text.minutes(numberFormat.format(settings.intervalLengthMinutes))
                            : text.notAvailable
                    }
                />
                {info.hasWaitStats && (
                    <Fact
                        label={text.waits}
                        value={
                            settings.waitStatsCapture === "on"
                                ? text.waitsCaptured
                                : text.waitsNotCaptured
                        }
                    />
                )}
                <Fact
                    label={text.cleanup}
                    value={
                        cleanupPercent !== undefined
                            ? text.cleanupAuto(percentFormat.format(cleanupPercent / 100))
                            : text.off
                    }
                />
            </div>
        </div>
    );
};

const StateBadge = ({ state }: { state: QueryStoreState }) => {
    const text = loc.performanceDashboard;
    const [color, label] = (
        {
            readWrite: ["success", text.stateCollecting],
            readOnly: ["warning", text.stateReadOnly],
            off: ["informative", text.stateOff],
            error: ["danger", text.stateError],
            readCapture: ["brand", text.stateReadCapture],
        } as const
    )[state];
    return (
        <Badge appearance="tint" shape="rounded" color={color}>
            {label}
        </Badge>
    );
};

const StorageBar = ({ settings }: { settings: QueryStoreSettings }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const use = storageUseOf(settings);
    if (!use) {
        return null;
    }
    return (
        <div className={classes.storage}>
            <div
                className={classes.track}
                role="meter"
                aria-label={text.storageLabel}
                aria-valuemin={0}
                aria-valuemax={use.maxMb}
                aria-valuenow={use.usedMb}
                aria-valuetext={text.storageUsed(
                    numberFormat.format(use.usedMb),
                    numberFormat.format(use.maxMb),
                )}>
                <div className={classes.fill} style={{ width: `${use.percent}%` }} />
                {use.cleanupPercent !== undefined && (
                    <div className={classes.marker} style={{ left: `${use.cleanupPercent}%` }} />
                )}
            </div>
            <div className={classes.storageLabels}>
                <Caption1 className={classes.used}>
                    {text.storageUsed(
                        numberFormat.format(use.usedMb),
                        numberFormat.format(use.maxMb),
                    )}
                </Caption1>
                <Caption1 className={classes.secondary}>
                    {use.cleanupPercent !== undefined
                        ? text.cleanupAt(percentFormat.format(use.cleanupPercent / 100))
                        : text.cleanupOff}
                </Caption1>
            </div>
        </div>
    );
};

const Fact = ({ label, value }: { label: string; value: string }) => {
    const classes = useStyles();
    return (
        <div className={classes.fact}>
            <Caption1 className={classes.secondary}>{label}</Caption1>
            <Text weight="semibold">{value}</Text>
        </div>
    );
};

interface SettingsFormProps {
    readonly settings: QueryStoreSettings;
    readonly form: QueryStoreSettingsForm;
    readonly hasWaitStats: boolean;
    readonly onChange: (form: QueryStoreSettingsForm) => void;
}

/** One row for each setting. Each choice marks the current value with a dot. */
const SettingsForm = ({ settings, form, hasWaitStats, onChange }: SettingsFormProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const current = formOf(settings);

    const option = <T extends string>(
        value: T,
        label: string,
        isCurrent: boolean,
    ): SegmentedControlOption<T> => ({
        value,
        label: isCurrent ? `${label} ·` : label,
        title: isCurrent ? text.currentValue : undefined,
    });
    const numberOptions = (choices: number[], currentValue: number | undefined) =>
        choices.map((choice) =>
            option(String(choice), numberFormat.format(choice), choice === currentValue),
        );

    const row = (label: string, control: ReactNode) => (
        <>
            <div className={classes.rowLabel}>
                <Text>{label}</Text>
            </div>
            <div className={classes.rowControl}>{control}</div>
        </>
    );

    const operationModes = [
        ...(current.operationMode === "off" ? [option("off" as const, text.off, true)] : []),
        option("readWrite" as const, text.readWrite, current.operationMode === "readWrite"),
        option("readOnly" as const, text.readOnly, current.operationMode === "readOnly"),
    ];
    const captureModes = [
        option("auto" as const, text.captureAuto, current.captureMode === "auto"),
        option("all" as const, text.captureAll, current.captureMode === "all"),
        option("none" as const, text.captureNone, current.captureMode === "none"),
        ...(current.captureMode === "custom"
            ? [option("custom" as const, text.captureCustom, true)]
            : []),
    ];

    return (
        <div className={classes.rows}>
            {row(
                text.operationMode,
                <SegmentedControl
                    size="small"
                    ariaLabel={text.operationMode}
                    value={form.operationMode}
                    options={operationModes}
                    onValueChange={(operationMode) => onChange({ ...form, operationMode })}
                />,
            )}
            {row(
                text.captureMode,
                <SegmentedControl
                    size="small"
                    ariaLabel={text.captureMode}
                    value={form.captureMode ?? "auto"}
                    options={captureModes}
                    onValueChange={(captureMode) => onChange({ ...form, captureMode })}
                />,
            )}
            {row(
                text.maxSizeMb,
                <SegmentedControl
                    size="small"
                    ariaLabel={text.maxSizeMb}
                    value={String(form.maxStorageMb ?? "")}
                    options={numberOptions(
                        numberChoices(maxSizeChoicesMb, settings.maxStorageMb),
                        current.maxStorageMb,
                    )}
                    onValueChange={(value) => onChange({ ...form, maxStorageMb: Number(value) })}
                />,
            )}
            {row(
                text.keepQueriesDays,
                <SegmentedControl
                    size="small"
                    ariaLabel={text.keepQueriesDays}
                    value={String(form.staleQueryThresholdDays ?? "")}
                    options={numberOptions(
                        numberChoices(keepDaysChoices, settings.staleQueryThresholdDays),
                        current.staleQueryThresholdDays,
                    )}
                    onValueChange={(value) =>
                        onChange({ ...form, staleQueryThresholdDays: Number(value) })
                    }
                />,
            )}
            {row(
                text.intervalMinutes,
                <SegmentedControl
                    size="small"
                    ariaLabel={text.intervalMinutes}
                    value={String(form.intervalLengthMinutes ?? "")}
                    options={numberOptions(
                        numberChoices(intervalChoicesMinutes, settings.intervalLengthMinutes),
                        current.intervalLengthMinutes,
                    )}
                    onValueChange={(value) =>
                        onChange({ ...form, intervalLengthMinutes: Number(value) })
                    }
                />,
            )}
            {hasWaitStats &&
                row(
                    text.waitStatistics,
                    <SegmentedControl
                        size="small"
                        ariaLabel={text.waitStatistics}
                        value={form.waitStatsCapture ?? "off"}
                        options={[
                            option("on" as const, text.on, current.waitStatsCapture === "on"),
                            option("off" as const, text.off, current.waitStatsCapture === "off"),
                        ]}
                        onValueChange={(waitStatsCapture) =>
                            onChange({ ...form, waitStatsCapture })
                        }
                    />,
                )}
        </div>
    );
};

function captureText(mode: QueryStoreCaptureMode | undefined): string {
    const text = loc.performanceDashboard;
    switch (mode) {
        case "all":
            return text.captureAll;
        case "none":
            return text.captureNone;
        case "custom":
            return text.captureCustom;
        case "auto":
            return text.captureAuto;
        default:
            return text.notAvailable;
    }
}

function readOnlyReasonText(reason: QueryStoreReadOnlyReason): string {
    const text = loc.performanceDashboard;
    switch (reason) {
        case "dbReadOnly":
            return text.readOnlyDbReadOnly;
        case "dbInSingleUserMode":
            return text.readOnlyDbInSingleUserMode;
        case "dbInEmergencyMode":
            return text.readOnlyDbInEmergencyMode;
        case "dbInLogAcceptMode":
            return text.readOnlyDbInLogAcceptMode;
        case "diskSizeLimit":
            return text.readOnlyDiskSizeLimit;
        default:
            return text.readOnlyMemoryLimit;
    }
}

function warningText(warning: QueryStoreSettingsWarning): string {
    const text = loc.performanceDashboard;
    switch (warning) {
        case "maxSizeBelowCurrentSize":
            return text.warningMaxSizeBelowCurrentSize;
        case "readOnlyStopsCapture":
            return text.warningReadOnlyStopsCapture;
        case "captureNoneStopsNewQueries":
            return text.warningCaptureNoneStopsNewQueries;
        case "turnsQueryStoreOn":
            return text.warningTurnsQueryStoreOn;
        default:
            return text.warningShorterIntervalUsesMoreStorage;
    }
}

function blockerText(blocker: QueryStoreSettingsBlocker): string {
    const text = loc.performanceDashboard;
    switch (blocker) {
        case "noChange":
            return text.blockerNoChange;
        case "permissionMissing":
            return text.blockerPermissionMissing;
        case "platformUnsupported":
            return text.blockerPlatformUnsupported;
        case "waitStatsUnsupported":
            return text.blockerWaitStatsUnsupported;
        case "queryStoreError":
            return text.blockerQueryStoreError;
        case "settingsChanged":
            return text.blockerSettingsChanged;
        default:
            return text.blockerPreparedSqlMismatch;
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
