/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Caption1,
    Caption1Strong,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Dropdown,
    InfoLabel,
    Input,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarBody,
    MessageBarIntent,
    Option,
    SkeletonItem,
    Spinner,
    Subtitle2,
    Switch,
    Text,
    tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { ReactNode, useState } from "react";
import type {
    PreparedQueryStoreSettingsChange,
    QueryStoreCaptureMode,
    QueryStoreCapturePolicy,
    QueryStoreReadOnlyReason,
    QueryStoreSettings,
    QueryStoreSettingsBlocker,
    QueryStoreSettingsWarning,
    QueryStoreState,
} from "../../../sharedInterfaces/performance";
import {
    ApplyQueryStoreSettingsChangeRequest,
    GetQueryStoreSettingsRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    PrepareQueryStoreSettingsChangeRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { SegmentedControl } from "../../common/segmentedControl";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ChangeDialog } from "./performanceDashboardChangeDialog";
import { DelayedSkeleton } from "./performanceDashboardSkeletons";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import {
    OperationModeChoice,
    QueryStoreSettingsForm,
    changeOf,
    defaultCapturePolicy,
    formOf,
    intervalChoicesMinutes,
    maxCaptureStaleHours,
    maxFlushMinutes,
    maxKeepDays,
    maxWholeNumber,
    numberChoices,
    storageUseOf,
    turnsOff,
} from "./performanceDashboardSettingsModel";
import { readStatusMessage } from "./performanceDashboardStatus";

const rowBorder = "1px solid var(--vscode-panel-border)";

const useStyles = makeStyles({
    body: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
    },
    // The storage in a card above the settings.
    storage: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "14px 16px",
        border: rowBorder,
        borderRadius: tokens.borderRadiusMedium,
    },
    storageLabels: {
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "space-between",
        gap: "8px",
    },
    track: {
        position: "relative",
        height: "6px",
        borderRadius: "3px",
        backgroundColor: tokens.colorNeutralBackground5,
    },
    fill: {
        height: "100%",
        borderRadius: "3px",
        backgroundColor: tokens.colorBrandBackground,
    },
    marker: {
        position: "absolute",
        top: "-4px",
        width: "2px",
        height: "14px",
        backgroundColor: tokens.colorNeutralForeground2,
    },
    group: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        marginTop: "8px",
    },
    groupTitle: {
        color: tokens.colorNeutralForeground3,
    },
    // A line between the rows of a group.
    groupRows: {
        display: "flex",
        flexDirection: "column",
    },
    // One setting: its label and info button, and its control on the right.
    row: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px 16px",
        padding: "10px 0",
        borderTop: rowBorder,
        "&:first-child": {
            borderTop: "none",
        },
    },
    unit: {
        color: tokens.colorNeutralForeground3,
    },
    // A threshold of the custom capture mode, under the capture mode.
    nestedRow: {
        paddingLeft: "16px",
        borderTop: "none",
    },
    // Dropdowns and number fields line up on the right.
    control: {
        width: "160px",
        minWidth: "160px",
    },
    rowText: {
        minWidth: "180px",
    },
    footer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        borderTop: rowBorder,
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    sectionTitle: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    skeleton: {
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        paddingTop: "4px",
    },
    skeletonRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
    },
    actions: {
        display: "flex",
        gap: "8px",
    },
});

interface Notice {
    readonly intent: MessageBarIntent;
    readonly text: string;
}

const numberFormat = new Intl.NumberFormat();
const percentFormat = new Intl.NumberFormat(undefined, { style: "percent" });

/**
 * The Query Store settings in the settings drawer: the storage, and a row of choices for each
 * setting. Review change prepares the T-SQL of the change and shows it in the change dialog;
 * the change runs only when the user selects Apply there.
 */
export const PerformanceDashboardQueryStoreSettings = ({ onClose }: { onClose: () => void }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refresh } = useRefresh();
    const [version, setVersion] = useState(0);
    const read = useExtensionRequest(GetQueryStoreSettingsRequest.type, undefined, [
        databaseName,
        version,
    ]);
    const [form, setForm] = useState<QueryStoreSettingsForm | undefined>(undefined);
    const [prepared, setPrepared] = useState<PreparedQueryStoreSettingsChange | undefined>(
        undefined,
    );
    const [applyError, setApplyError] = useState<string | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<Notice | undefined>(undefined);

    const info = read.result && "data" in read.result ? read.result.data : undefined;
    const settings = info?.settings;

    const header = (
        <DrawerHeader>
            <DrawerHeaderTitle
                action={
                    <Button
                        appearance="subtle"
                        aria-label={loc.common.close}
                        icon={<Dismiss24Regular />}
                        onClick={onClose}
                    />
                }>
                {text.settings}
            </DrawerHeaderTitle>
        </DrawerHeader>
    );

    // The Query Store section: its title and state, then its content.
    const section = (state: QueryStoreState | undefined, content: ReactNode) => (
        <section className={classes.section} aria-label={text.queryStore}>
            <div className={classes.sectionTitle}>
                <Subtitle2>{text.queryStore}</Subtitle2>
                {state && <StateBadge state={state} />}
            </div>
            {content}
        </section>
    );

    if (!settings || !info) {
        const unsupported = read.result?.status === "unsupported";
        const message = unsupported ? undefined : readStatusMessage(read);
        return (
            <>
                {header}
                <DrawerBody className={classes.body}>
                    {section(
                        undefined,
                        unsupported ? (
                            <Caption1 className={classes.secondary}>
                                {text.noQueryStoreSettings}
                            </Caption1>
                        ) : message ? (
                            <MessageBar intent={message.intent}>
                                <MessageBarBody>{message.text}</MessageBarBody>
                            </MessageBar>
                        ) : (
                            <SettingsSkeleton />
                        ),
                    )}
                </DrawerBody>
            </>
        );
    }

    const currentForm = form ?? formOf(settings);
    const change = changeOf(currentForm, settings);
    const changeCount = Object.keys(change).length;
    const hasChange = changeCount > 0;
    const canPrepare = hasChange && info.canAlter && info.canChange && !busy;

    const prepare = async () => {
        setBusy(true);
        setNotice(undefined);
        try {
            const result = await extensionRpc.sendRequest(
                PrepareQueryStoreSettingsChangeRequest.type,
                change,
            );
            if ("data" in result && result.data) {
                setApplyError(undefined);
                setPrepared(result.data);
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

    const apply = async (change: PreparedQueryStoreSettingsChange) => {
        setBusy(true);
        setApplyError(undefined);
        try {
            const result = await extensionRpc.sendRequest(
                ApplyQueryStoreSettingsChangeRequest.type,
                change,
            );
            if ("data" in result && result.data?.applied) {
                setPrepared(undefined);
                setForm(undefined);
                setNotice({ intent: "success", text: text.settingsChanged });
                setVersion((value) => value + 1);
                // The views read Query Store, so they show the new settings' effect.
                refresh();
            } else if ("data" in result && result.data) {
                setApplyError(result.data.blockers.map(blockerText).join(" "));
                setVersion((value) => value + 1);
            } else {
                const message = readStatusMessage({ loading: false, result });
                setApplyError(message?.text ?? text.readFailed(result.status));
            }
        } catch (error) {
            setApplyError(text.readFailed(errorText(error)));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            {header}
            <DrawerBody className={classes.body}>
                {notice && (
                    <MessageBar intent={notice.intent}>
                        <MessageBarBody>{notice.text}</MessageBarBody>
                    </MessageBar>
                )}
                {section(
                    settings.actualState,
                    <>
                        {!info.canAlter && (
                            <MessageBar intent="error">
                                <MessageBarBody>{text.alterPermissionMissing}</MessageBarBody>
                            </MessageBar>
                        )}
                        {settings.actualState === "readOnly" && settings.readOnlyReason && (
                            <MessageBar intent="warning">
                                <MessageBarBody>
                                    {text.queryStoreReadOnlyBecause(
                                        readOnlyReasonText(settings.readOnlyReason),
                                    )}
                                </MessageBarBody>
                            </MessageBar>
                        )}
                        {!info.canChange && (
                            <MessageBar intent="info">
                                <MessageBarBody>{text.settingsNotChangeable}</MessageBarBody>
                            </MessageBar>
                        )}
                        <StorageBar settings={settings} />
                        <SettingsRows
                            settings={settings}
                            form={currentForm}
                            hasWaitStats={info.hasWaitStats}
                            hasCapturePolicy={info.hasCapturePolicy}
                            canTurnOff={info.canTurnOff}
                            disabled={!info.canChange || !info.canAlter || busy}
                            onChange={setForm}
                        />
                    </>,
                )}
            </DrawerBody>
            <DrawerFooter className={classes.footer}>
                <Caption1 className={classes.secondary}>
                    {changeCount === 0 ? text.noChanges : text.changeCount(changeCount)}
                </Caption1>
                <div className={classes.actions}>
                    <Button disabled={busy} onClick={onClose}>
                        {loc.common.cancel}
                    </Button>
                    <Button
                        appearance="primary"
                        disabled={!canPrepare}
                        onClick={() => void prepare()}>
                        {busy && !prepared ? <Spinner size="tiny" /> : text.prepareForReview}
                    </Button>
                </div>
            </DrawerFooter>
            {prepared && (
                <ChangeDialog
                    title={text.changeQueryStoreSettings}
                    sql={prepared.sql}
                    blockers={prepared.blockers.map(blockerText)}
                    warnings={prepared.warnings.map(warningText)}
                    error={applyError}
                    busy={busy}
                    onApply={() => void apply(prepared)}
                    onCancel={() => setPrepared(undefined)}
                />
            )}
        </>
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

/** The shape of the storage and the setting rows while the settings load. */
const SettingsSkeleton = () => {
    const classes = useStyles();
    return (
        <DelayedSkeleton className={classes.skeleton}>
            <SkeletonItem style={{ height: 6 }} />
            {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className={classes.skeletonRow}>
                    <SkeletonItem style={{ width: 200, height: 28 }} />
                    <SkeletonItem style={{ width: 160, height: 24 }} />
                </div>
            ))}
        </DelayedSkeleton>
    );
};

/** The used and maximum size, with a mark where size-based cleanup starts. */
const StorageBar = ({ settings }: { settings: QueryStoreSettings }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const use = storageUseOf(settings);
    if (!use) {
        return null;
    }
    return (
        <div className={classes.storage}>
            <div className={classes.storageLabels}>
                <Text>
                    <Text weight="semibold">
                        {text.storageUsedAmount(numberFormat.format(use.usedMb))}
                    </Text>{" "}
                    <span className={classes.secondary}>
                        {text.storageOfMax(numberFormat.format(use.maxMb))}
                    </span>
                </Text>
                <Caption1 className={classes.secondary}>
                    {use.cleanupPercent !== undefined
                        ? text.cleanupAt(percentFormat.format(use.cleanupPercent / 100))
                        : text.cleanupOff}
                </Caption1>
            </div>
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
        </div>
    );
};

interface SettingsRowsProps {
    readonly settings: QueryStoreSettings;
    readonly form: QueryStoreSettingsForm;
    readonly hasWaitStats: boolean;
    readonly hasCapturePolicy: boolean;
    readonly canTurnOff: boolean;
    readonly disabled: boolean;
    readonly onChange: (form: QueryStoreSettingsForm) => void;
}

/**
 * The settings in groups: collection, storage, and timing. Each row has its label with its
 * description in an info button, and the control that fits its values: a segmented control for
 * a few exclusive modes, a dropdown for a list, a number field with its unit, or a switch. The
 * custom capture mode shows its thresholds below it. Turning Query Store off is a change of its
 * own, so the other settings are off while Off is the choice.
 */
const SettingsRows = ({
    settings,
    form,
    hasWaitStats,
    hasCapturePolicy,
    canTurnOff,
    disabled,
    onChange,
}: SettingsRowsProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const current = formOf(settings);
    const othersDisabled = disabled || turnsOff(form, settings);

    const group = (title: string, rows: ReactNode) => (
        <div className={classes.group}>
            <Caption1Strong className={classes.groupTitle}>{title}</Caption1Strong>
            <div className={classes.groupRows}>{rows}</div>
        </div>
    );
    const row = (
        id: string,
        label: string,
        description: string,
        control: ReactNode,
        nested = false,
    ) => (
        <div className={mergeClasses(classes.row, nested && classes.nestedRow)}>
            <InfoLabel className={classes.rowText} htmlFor={id} info={description}>
                {label}
            </InfoLabel>
            {control}
        </div>
    );
    const numberField = (
        id: string,
        value: number | undefined,
        unit: string | undefined,
        max: number,
        onValue: (value: number) => void,
    ) => (
        <NumberField
            id={id}
            className={classes.control}
            value={value}
            unit={unit}
            min={1}
            max={max}
            disabled={othersDisabled}
            onValue={onValue}
        />
    );

    const captureModes: { value: QueryStoreCaptureMode; label: string }[] = [
        { value: "auto", label: text.captureAuto },
        { value: "all", label: text.captureAll },
        { value: "none", label: text.captureNone },
        ...(hasCapturePolicy || current.captureMode === "custom"
            ? [{ value: "custom" as const, label: text.captureCustom }]
            : []),
    ];
    const captureMode = form.captureMode ?? "auto";
    const intervals = numberChoices(intervalChoicesMinutes, settings.intervalLengthMinutes);
    const policy = form.capturePolicy ?? current.capturePolicy ?? defaultCapturePolicy;
    const setPolicy = (key: keyof QueryStoreCapturePolicy) => (value: number) =>
        onChange({ ...form, capturePolicy: { ...policy, [key]: value } });

    return (
        <>
            {group(
                text.groupCollection,
                <>
                    {row(
                        "qs-operation-mode",
                        text.operationMode,
                        text.operationModeDescription,
                        <SegmentedControl<OperationModeChoice>
                            size="small"
                            ariaLabel={text.operationMode}
                            value={form.operationMode}
                            options={[
                                { value: "readWrite", label: text.readWrite, disabled },
                                { value: "readOnly", label: text.readOnly, disabled },
                                ...(canTurnOff || current.operationMode === "off"
                                    ? [{ value: "off" as const, label: text.off, disabled }]
                                    : []),
                            ]}
                            onValueChange={(operationMode) => onChange({ ...form, operationMode })}
                        />,
                    )}
                    {row(
                        "qs-capture-mode",
                        text.captureMode,
                        text.captureModeDescription,
                        <Dropdown
                            id="qs-capture-mode"
                            className={classes.control}
                            disabled={othersDisabled}
                            value={
                                captureModes.find((mode) => mode.value === captureMode)?.label ?? ""
                            }
                            selectedOptions={[captureMode]}
                            onOptionSelect={(_event, data) =>
                                data.optionValue &&
                                onChange({
                                    ...form,
                                    captureMode: data.optionValue as QueryStoreCaptureMode,
                                })
                            }>
                            {captureModes.map((mode) => (
                                <Option key={mode.value} value={mode.value}>
                                    {mode.label}
                                </Option>
                            ))}
                        </Dropdown>,
                    )}
                    {captureMode === "custom" && (
                        <>
                            {row(
                                "qs-policy-stale",
                                text.capturePolicyStale,
                                text.capturePolicyStaleDescription,
                                numberField(
                                    "qs-policy-stale",
                                    policy.staleThresholdHours,
                                    text.unitHours,
                                    maxCaptureStaleHours,
                                    setPolicy("staleThresholdHours"),
                                ),
                                true,
                            )}
                            {row(
                                "qs-policy-executions",
                                text.capturePolicyExecutionCount,
                                text.capturePolicyExecutionCountDescription,
                                numberField(
                                    "qs-policy-executions",
                                    policy.executionCount,
                                    undefined,
                                    maxWholeNumber,
                                    setPolicy("executionCount"),
                                ),
                                true,
                            )}
                            {row(
                                "qs-policy-compile",
                                text.capturePolicyCompileCpu,
                                text.capturePolicyCompileCpuDescription,
                                numberField(
                                    "qs-policy-compile",
                                    policy.totalCompileCpuTimeMs,
                                    text.unitMs,
                                    maxWholeNumber,
                                    setPolicy("totalCompileCpuTimeMs"),
                                ),
                                true,
                            )}
                            {row(
                                "qs-policy-execution-cpu",
                                text.capturePolicyExecutionCpu,
                                text.capturePolicyExecutionCpuDescription,
                                numberField(
                                    "qs-policy-execution-cpu",
                                    policy.totalExecutionCpuTimeMs,
                                    text.unitMs,
                                    maxWholeNumber,
                                    setPolicy("totalExecutionCpuTimeMs"),
                                ),
                                true,
                            )}
                        </>
                    )}
                    {hasWaitStats &&
                        row(
                            "qs-wait-stats",
                            text.waitStatistics,
                            text.waitStatisticsDescription,
                            <Switch
                                id="qs-wait-stats"
                                disabled={othersDisabled}
                                checked={form.waitStatsCapture === "on"}
                                onChange={(_event, data) =>
                                    onChange({
                                        ...form,
                                        waitStatsCapture: data.checked ? "on" : "off",
                                    })
                                }
                            />,
                        )}
                </>,
            )}
            {group(
                text.groupStorage,
                <>
                    {row(
                        "qs-max-size",
                        text.maxSize,
                        text.maxSizeDescription,
                        numberField(
                            "qs-max-size",
                            form.maxStorageMb,
                            text.unitMb,
                            maxWholeNumber,
                            (maxStorageMb) => onChange({ ...form, maxStorageMb }),
                        ),
                    )}
                    {settings.sizeBasedCleanup !== undefined &&
                        row(
                            "qs-size-cleanup",
                            text.sizeBasedCleanup,
                            text.sizeBasedCleanupDescription,
                            <Switch
                                id="qs-size-cleanup"
                                disabled={othersDisabled}
                                checked={form.sizeBasedCleanup !== "off"}
                                onChange={(_event, data) =>
                                    onChange({
                                        ...form,
                                        sizeBasedCleanup: data.checked ? "auto" : "off",
                                    })
                                }
                            />,
                        )}
                    {row(
                        "qs-keep-days",
                        text.keepQueriesFor,
                        text.keepQueriesDescription,
                        numberField(
                            "qs-keep-days",
                            form.staleQueryThresholdDays,
                            text.unitDays,
                            maxKeepDays,
                            (staleQueryThresholdDays) =>
                                onChange({ ...form, staleQueryThresholdDays }),
                        ),
                    )}
                </>,
            )}
            {group(
                text.groupTiming,
                <>
                    {form.flushIntervalSeconds !== undefined &&
                        row(
                            "qs-flush",
                            text.flushInterval,
                            text.flushIntervalDescription,
                            numberField(
                                "qs-flush",
                                Math.round(form.flushIntervalSeconds / 60),
                                text.unitMinutes,
                                maxFlushMinutes,
                                (minutes) =>
                                    onChange({ ...form, flushIntervalSeconds: minutes * 60 }),
                            ),
                        )}
                    {row(
                        "qs-interval",
                        text.statisticsInterval,
                        text.intervalDescription,
                        <Dropdown
                            id="qs-interval"
                            className={classes.control}
                            disabled={othersDisabled}
                            value={
                                form.intervalLengthMinutes !== undefined
                                    ? intervalLabel(form.intervalLengthMinutes)
                                    : ""
                            }
                            selectedOptions={
                                form.intervalLengthMinutes !== undefined
                                    ? [String(form.intervalLengthMinutes)]
                                    : []
                            }
                            onOptionSelect={(_event, data) =>
                                data.optionValue &&
                                onChange({
                                    ...form,
                                    intervalLengthMinutes: Number(data.optionValue),
                                })
                            }>
                            {intervals.map((minutes) => (
                                <Option key={minutes} value={String(minutes)}>
                                    {intervalLabel(minutes)}
                                </Option>
                            ))}
                        </Dropdown>,
                    )}
                </>,
            )}
        </>
    );
};

/** An interval as minutes, or as 1 hour or 1 day. */
function intervalLabel(minutes: number): string {
    const text = loc.performanceDashboard;
    return minutes === 60
        ? text.oneHour
        : minutes === 1440
          ? text.oneDay
          : text.minutes(numberFormat.format(minutes));
}

interface NumberFieldProps {
    readonly id: string;
    readonly className?: string;
    readonly value: number | undefined;
    /** The unit after the number, for example MB. */
    readonly unit?: string;
    readonly min: number;
    readonly max: number;
    readonly disabled?: boolean;
    readonly onValue: (value: number) => void;
}

/**
 * A whole number with its unit inside the field. The text can be anything while it is typed; a
 * whole number from `min` to `max` changes the value, and leaving the field puts back the value
 * when the text is not one.
 */
const NumberField = ({
    id,
    className,
    value,
    unit,
    min,
    max,
    disabled,
    onValue,
}: NumberFieldProps) => {
    const classes = useStyles();
    const shown = value === undefined ? "" : String(value);
    const [draft, setDraft] = useState<string | undefined>(undefined);
    const valid = (input: string) => {
        const number = Number(input.trim());
        return input.trim() !== "" && Number.isInteger(number) && number >= min && number <= max;
    };
    const textValue = draft ?? shown;
    return (
        <Input
            id={id}
            className={className}
            inputMode="numeric"
            disabled={disabled}
            value={textValue}
            aria-invalid={draft !== undefined && !valid(draft)}
            contentAfter={unit ? <Caption1 className={classes.unit}>{unit}</Caption1> : undefined}
            onChange={(_event, data) => {
                setDraft(data.value);
                if (valid(data.value)) {
                    onValue(Number(data.value.trim()));
                }
            }}
            onBlur={() => setDraft(undefined)}
        />
    );
};

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
        case "turnsQueryStoreOff":
            return text.warningTurnsQueryStoreOff;
        case "sizeBasedCleanupOffCanFill":
            return text.warningSizeBasedCleanupOff;
        case "longerFlushIntervalLosesMoreData":
            return text.warningLongerFlushInterval;
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
        case "capturePolicyUnsupported":
            return text.blockerCapturePolicyUnsupported;
        case "turnOffUnsupported":
            return text.blockerTurnOffUnsupported;
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
