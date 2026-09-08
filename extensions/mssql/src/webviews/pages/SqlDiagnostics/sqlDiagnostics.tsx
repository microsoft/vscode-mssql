/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Badge,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    Input,
    MessageBar,
    Menu,
    MenuTrigger,
    MenuPopover,
    MenuList,
    MenuItem,
    Option,
    Spinner,
    Text,
    Textarea,
    Tooltip,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    Add16Regular,
    ArrowClockwise16Regular,
    ArrowDownload16Regular,
    Open16Regular,
    Play16Regular,
    Stop16Regular,
} from "@fluentui/react-icons";

import { DiagnosticsQuerySummary, NewJobRequest } from "../../../sharedInterfaces/sqlDiagnostics";
import { SqlDiagnosticsContext } from "./sqlDiagnosticsStateProvider";
import { useSqlDiagnosticsSelector } from "./sqlDiagnosticsSelector";
import { QueryStoreReadinessPanel } from "./queryStoreReadiness";
import { DiagnosticsResults } from "./diagnosticsResults";
import { JobHistoryResults } from "./jobHistoryResults";
import { QueryStoreSettings } from "./queryStoreSettings";
import { AgentReadinessPanel } from "./agentReadiness";
import { JobScheduleEditor, validJobSchedule } from "./jobScheduleEditor";
import { LocConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    form: { display: "flex", flexDirection: "column", rowGap: "12px", minWidth: "420px" },
    formRow: { display: "flex", columnGap: "12px" },
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
    },
    header: {
        display: "flex",
        flexDirection: "column",
        rowGap: "4px",
        padding: "12px 16px 8px 16px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    serverLine: {
        display: "flex",
        flexWrap: "wrap",
        columnGap: "12px",
        rowGap: "4px",
        alignItems: "center",
        color: tokens.colorNeutralForeground3,
    },
    body: {
        display: "flex",
        flexGrow: 1,
        minHeight: 0,
    },
    sidebar: {
        width: "300px",
        flexShrink: 0,
        overflowY: "auto",
        borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
        padding: "8px",
        display: "flex",
        flexDirection: "column",
        rowGap: "2px",
    },
    queryItem: {
        display: "flex",
        flexDirection: "column",
        rowGap: "2px",
        textAlign: "left",
        width: "100%",
        padding: "8px",
        borderRadius: tokens.borderRadiusMedium,
        cursor: "pointer",
        backgroundColor: "transparent",
        border: "none",
        color: tokens.colorNeutralForeground1,
        ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    queryItemSelected: { backgroundColor: tokens.colorNeutralBackground1Selected },
    queryItemDisabled: { opacity: 0.55, cursor: "not-allowed" },
    queryTitle: { fontWeight: tokens.fontWeightSemibold },
    queryDescription: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
    content: {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
    },
    toolbar: {
        display: "flex",
        alignItems: "center",
        columnGap: "8px",
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    spacer: { flexGrow: 1 },
    gridWrap: { flexGrow: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" },
    table: { borderCollapse: "collapse", width: "100%", fontSize: tokens.fontSizeBase200 },
    th: {
        position: "sticky",
        top: 0,
        textAlign: "left",
        whiteSpace: "nowrap",
        backgroundColor: tokens.colorNeutralBackground2,
        padding: "6px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    td: {
        padding: "5px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        verticalAlign: "top",
        maxWidth: "520px",
        overflowWrap: "anywhere",
    },
    numeric: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
    empty: {
        padding: "32px",
        color: tokens.colorNeutralForeground3,
        textAlign: "center",
    },
    messages: {
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        rowGap: "6px",
    },
});

/** Blank form state, also used to reset after a successful create. */
const emptyJob = (defaultDatabase: string): NewJobRequest => ({
    name: "",
    description: "",
    enabled: false,
    steps: [{ name: "", command: "", database: defaultDatabase }],
});

/** Draft job definition, retained until the host acknowledges creation. */
export const NewJobDialog: React.FC<{
    open: boolean;
    defaultDatabase: string;
    onClose: () => void;
    onCreate: (request: NewJobRequest) => void;
}> = ({ open, defaultDatabase, onClose, onCreate }) => {
    const styles = useStyles();
    const [job, setJob] = useState<NewJobRequest>(() => emptyJob(defaultDatabase));

    const creation = useSqlDiagnosticsSelector((s) => s.jobCreation);
    const loc = LocConstants.getInstance().agentCreation;
    const lastCreatedId = useRef(creation?.createdJobId);
    useEffect(() => {
        if (creation?.createdJobId && creation.createdJobId !== lastCreatedId.current) {
            lastCreatedId.current = creation.createdJobId;
            setJob(emptyJob(defaultDatabase));
            onClose();
        }
    }, [creation?.createdJobId, defaultDatabase, onClose]);

    const canCreate =
        job.name.trim().length > 0 &&
        validJobSchedule(job.schedule) &&
        job.steps.length > 0 &&
        job.steps.every(
            (step) =>
                step.name.trim().length > 0 &&
                step.database?.trim().length > 0 &&
                step.command.trim().length > 0 &&
                [step.retryAttempts ?? 0, step.retryIntervalMinutes ?? 0].every(
                    (value) => Number.isInteger(value) && value >= 0 && value <= 2147483647,
                ),
        );
    const setStep = (index: number, patch: Partial<NewJobRequest["steps"][number]>) =>
        setJob((current) => ({
            ...current,
            steps: current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
        }));
    const moveStep = (index: number, offset: number) =>
        setJob((current) => {
            const steps = [...current.steps];
            const destination = index + offset;
            if (destination < 0 || destination >= steps.length) return current;
            [steps[index], steps[destination]] = [steps[destination], steps[index]];
            return { ...current, steps };
        });

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    onClose();
                }
            }}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{loc.title}</DialogTitle>
                    <DialogContent>
                        <Text>{loc.handoff}</Text>
                        {creation?.error && (
                            <MessageBar intent="error">{creation.error}</MessageBar>
                        )}
                        <fieldset disabled={creation?.busy} className={styles.form}>
                            <Field label={loc.jobName} required>
                                <Input
                                    value={job.name}
                                    onChange={(_, data) =>
                                        setJob((c) => ({ ...c, name: data.value }))
                                    }
                                />
                            </Field>
                            <Field label={loc.description}>
                                <Input
                                    value={job.description}
                                    onChange={(_, data) =>
                                        setJob((c) => ({ ...c, description: data.value }))
                                    }
                                />
                            </Field>
                            <Text>{loc.routing}</Text>
                            {job.steps.map((step, index) => (
                                <fieldset key={index} className={styles.form}>
                                    <legend>{loc.step(index + 1)}</legend>
                                    <div className={styles.formRow}>
                                        <Field
                                            label={loc.stepName}
                                            required
                                            style={{ flexGrow: 1 }}>
                                            <Input
                                                value={step.name}
                                                onChange={(_, data) =>
                                                    setStep(index, { name: data.value })
                                                }
                                            />
                                        </Field>
                                        <Field
                                            label={loc.database}
                                            required
                                            style={{ flexGrow: 1 }}>
                                            <Input
                                                value={step.database}
                                                placeholder={defaultDatabase}
                                                onChange={(_, data) =>
                                                    setStep(index, { database: data.value })
                                                }
                                            />
                                        </Field>
                                    </div>
                                    <Field label={loc.command} required>
                                        <Textarea
                                            resize="vertical"
                                            rows={4}
                                            value={step.command}
                                            onChange={(_, data) =>
                                                setStep(index, { command: data.value })
                                            }
                                        />
                                    </Field>
                                    <div className={styles.formRow}>
                                        <Field label={loc.retryAttempts}>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={2147483647}
                                                step={1}
                                                value={String(step.retryAttempts ?? 0)}
                                                onChange={(_, data) =>
                                                    setStep(index, {
                                                        retryAttempts: Number(data.value),
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label={loc.retryInterval}>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={2147483647}
                                                step={1}
                                                value={String(step.retryIntervalMinutes ?? 0)}
                                                onChange={(_, data) =>
                                                    setStep(index, {
                                                        retryIntervalMinutes: Number(data.value),
                                                    })
                                                }
                                            />
                                        </Field>
                                    </div>
                                    <Text>{loc.retryHelp}</Text>
                                    <div className={styles.formRow}>
                                        <Button
                                            disabled={index === 0}
                                            onClick={() => moveStep(index, -1)}>
                                            {loc.moveUp}
                                        </Button>
                                        <Button
                                            disabled={index === job.steps.length - 1}
                                            onClick={() => moveStep(index, 1)}>
                                            {loc.moveDown}
                                        </Button>
                                        <Button
                                            disabled={job.steps.length === 1}
                                            onClick={() =>
                                                setJob((current) => ({
                                                    ...current,
                                                    steps: current.steps.filter(
                                                        (_, i) => i !== index,
                                                    ),
                                                }))
                                            }>
                                            {loc.removeStep}
                                        </Button>
                                    </div>
                                </fieldset>
                            ))}
                            <Button
                                onClick={() =>
                                    setJob((current) => ({
                                        ...current,
                                        steps: [
                                            ...current.steps,
                                            { name: "", command: "", database: defaultDatabase },
                                        ],
                                    }))
                                }>
                                {loc.addStep}
                            </Button>
                            <JobScheduleEditor
                                value={job.schedule}
                                onChange={(schedule) =>
                                    setJob((current) => ({ ...current, schedule }))
                                }
                            />
                            <Checkbox
                                checked={job.enabled}
                                label={loc.enabled}
                                onChange={(_, data) =>
                                    setJob((c) => ({ ...c, enabled: data.checked === true }))
                                }
                            />
                        </fieldset>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {loc.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={!canCreate || creation?.busy}
                            onClick={() => {
                                onCreate(job);
                            }}>
                            {creation?.busy ? loc.reviewing : loc.review}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

const SqlDiagnosticsPage = () => {
    const styles = useStyles();
    const context = useContext(SqlDiagnosticsContext);
    const pageLoc = LocConstants.getInstance().sqlFeaturePage;
    const [jobActionTarget, setJobActionTarget] = useState<string | undefined>(undefined);
    const [showNewJob, setShowNewJob] = useState(false);
    const [showQueryStoreSettings, setShowQueryStoreSettings] = useState(false);

    const actionLoc = LocConstants.getInstance().agentActions;
    const jobActionBusy = useSqlDiagnosticsSelector((s) => s.jobActionBusy);
    const agentReadiness = useSqlDiagnosticsSelector((s) => s.agentReadiness);
    const agentReadinessBusy = useSqlDiagnosticsSelector((s) => s.agentReadinessBusy);
    const queryStore = useSqlDiagnosticsSelector((s) => s.queryStore);
    const section = useSqlDiagnosticsSelector((s) => s.section);
    const queries = useSqlDiagnosticsSelector((s) => s.queries);
    const server = useSqlDiagnosticsSelector((s) => s.server);
    const result = useSqlDiagnosticsSelector((s) => s.result);
    const isLoading = useSqlDiagnosticsSelector((s) => s.isLoading);
    const errorMessage = useSqlDiagnosticsSelector((s) => s.errorMessage);
    const jobOptions = useSqlDiagnosticsSelector((s) => s.jobOptions);
    const selectedQueryId = useSqlDiagnosticsSelector((s) => s.selectedQueryId);
    const selectedJobId = useSqlDiagnosticsSelector((s) => s.selectedJobId);
    const hasJobActionTarget = jobOptions.some((job) => job.id === jobActionTarget);

    const visibleQueries = useMemo(
        () => (queries ?? []).filter((q) => q.section === section),
        [queries, section],
    );

    if (!context) {
        return <Spinner label={pageLoc.identifying} />;
    }

    const selected = (queries ?? []).find((q) => q.id === selectedQueryId);
    const needsJob = selected?.requiresSelection === true;

    const renderQuery = (query: DiagnosticsQuerySummary) => {
        const isSelected = query.id === selectedQueryId;
        const className = [
            styles.queryItem,
            isSelected ? styles.queryItemSelected : "",
            query.available ? "" : styles.queryItemDisabled,
        ]
            .filter(Boolean)
            .join(" ");

        const item = (
            <button
                key={query.id}
                className={className}
                disabled={!query.available}
                onClick={() => context.runQuery(query.id)}
                aria-label={query.title}>
                <span className={styles.queryTitle}>{query.title}</span>
                <span className={styles.queryDescription}>{query.description}</span>
            </button>
        );

        // A disabled entry is only useful if it says why, so the reason rides a tooltip.
        return query.available ? (
            item
        ) : (
            <Tooltip
                key={query.id}
                content={query.unavailableReason ?? pageLoc.notAvailableOnServer}
                relationship="description">
                <span>{item}</span>
            </Tooltip>
        );
    };

    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <Text weight="semibold" size={500}>
                    {LocConstants.getInstance().sqlFeatures[section]}
                </Text>
                <div className={styles.serverLine}>
                    {server ? (
                        <>
                            <Text size={200}>{server.serverName ?? pageLoc.connectedServer}</Text>
                            <Badge appearance="outline">{server.platformName}</Badge>
                            {server.edition && <Text size={200}>{server.edition}</Text>}
                            {server.database && (
                                <Text size={200}>{pageLoc.database(server.database)}</Text>
                            )}
                            {section === "agent" && !server.hasSqlAgent && (
                                <Badge appearance="outline" color="informative">
                                    {pageLoc.noAgent}
                                </Badge>
                            )}
                        </>
                    ) : (
                        <Text size={200}>{pageLoc.identifying}</Text>
                    )}
                </div>
            </div>

            {section === "agent" && agentReadiness && (
                <AgentReadinessPanel
                    state={agentReadiness}
                    busy={!!agentReadinessBusy}
                    recheck={() => context.recheckAgent()}
                />
            )}
            <div className={styles.body}>
                <div className={styles.sidebar}>{visibleQueries.map(renderQuery)}</div>

                <div className={styles.content}>
                    {section === "querystore" && queryStore && (
                        <QueryStoreReadinessPanel
                            state={queryStore}
                            busy={isLoading}
                            recheck={() => context.refresh()}
                            chooseDatabase={() => context.chooseDatabase()}
                            review={() => setShowQueryStoreSettings(true)}
                        />
                    )}
                    <div className={styles.toolbar}>
                        {(selectedQueryId === "dmv.waitStats" ||
                            selectedQueryId === "dmv.waitStatsAzure") && (
                            <Checkbox
                                label={LocConstants.getInstance().sqlWaits.showBackground}
                                checked={result?.params?.showBackground === true}
                                disabled={isLoading}
                                onChange={(_, data) =>
                                    context.runQuery(selectedQueryId, {
                                        showBackground: data.checked === true,
                                    })
                                }
                            />
                        )}
                        <Button
                            icon={<ArrowClockwise16Regular />}
                            appearance="subtle"
                            disabled={!selectedQueryId || isLoading}
                            onClick={() => context.refresh()}>
                            {pageLoc.refresh}
                        </Button>
                        <Button
                            icon={<Open16Regular />}
                            appearance="subtle"
                            disabled={!selectedQueryId}
                            onClick={() => context.openInEditor(selectedQueryId!)}>
                            {pageLoc.openSql}
                        </Button>
                        <Button
                            icon={<ArrowDownload16Regular />}
                            appearance="subtle"
                            disabled={!result || result.rows.length === 0}
                            onClick={() => context.exportCsv()}>
                            {pageLoc.exportCsv}
                        </Button>

                        {needsJob && (
                            <Dropdown
                                placeholder={pageLoc.agent.chooseJob}
                                selectedOptions={selectedJobId ? [selectedJobId] : []}
                                value={
                                    jobOptions.find((job) => job.id === selectedJobId)?.name ?? ""
                                }
                                onOptionSelect={(_, data) => {
                                    if (data.optionValue) {
                                        context.selectJob(data.optionValue);
                                    }
                                }}>
                                {jobOptions.map((job) => (
                                    <Option key={job.id} value={job.id}>
                                        {job.name}
                                    </Option>
                                ))}
                            </Dropdown>
                        )}

                        {section === "agent" && server?.hasSqlAgent && (
                            <Button
                                icon={<Add16Regular />}
                                appearance="subtle"
                                onClick={() => setShowNewJob(true)}>
                                {pageLoc.agent.newJob}
                            </Button>
                        )}

                        {section === "agent" && selectedQueryId === "agent.jobs" && (
                            <>
                                <Dropdown
                                    placeholder={pageLoc.agent.jobToManage}
                                    selectedOptions={jobActionTarget ? [jobActionTarget] : []}
                                    value={
                                        jobOptions.find((job) => job.id === jobActionTarget)
                                            ?.name ?? ""
                                    }
                                    onOptionSelect={(_, data) =>
                                        setJobActionTarget(data.optionValue)
                                    }>
                                    {jobOptions.map((job) => (
                                        <Option key={job.id} value={job.id}>
                                            {job.name}
                                        </Option>
                                    ))}
                                </Dropdown>
                                <Button
                                    icon={<Play16Regular />}
                                    appearance="subtle"
                                    disabled={
                                        !hasJobActionTarget ||
                                        jobActionBusy ||
                                        agentReadiness?.service === "stopped"
                                    }
                                    onClick={() => context.jobAction(jobActionTarget!, "start")}>
                                    {actionLoc.start}
                                </Button>
                                <Button
                                    icon={<Stop16Regular />}
                                    appearance="subtle"
                                    disabled={
                                        !hasJobActionTarget ||
                                        jobActionBusy ||
                                        agentReadiness?.service === "stopped"
                                    }
                                    onClick={() => context.jobAction(jobActionTarget!, "stop")}>
                                    {actionLoc.stop}
                                </Button>
                                <Menu>
                                    <MenuTrigger disableButtonEnhancement>
                                        <Button disabled={!hasJobActionTarget || jobActionBusy}>
                                            {actionLoc.manage}
                                        </Button>
                                    </MenuTrigger>
                                    <MenuPopover>
                                        <MenuList>
                                            {(["enable", "disable", "delete"] as const).map(
                                                (action) => (
                                                    <MenuItem
                                                        key={action}
                                                        onClick={() =>
                                                            context.jobAction(
                                                                jobActionTarget!,
                                                                action,
                                                            )
                                                        }>
                                                        {actionLoc[action]}
                                                    </MenuItem>
                                                ),
                                            )}
                                        </MenuList>
                                    </MenuPopover>
                                </Menu>
                            </>
                        )}

                        <div className={styles.spacer} />
                        {isLoading && <Spinner size="tiny" label={pageLoc.running} />}
                        {result && !isLoading && (
                            <Text size={200}>
                                {pageLoc.rows(result.rows.length, result.durationMs)}
                            </Text>
                        )}
                    </div>

                    {(errorMessage || result?.truncated) && (
                        <div className={styles.messages}>
                            {errorMessage && <MessageBar intent="error">{errorMessage}</MessageBar>}
                            {result?.truncated && (
                                <MessageBar intent="warning">{pageLoc.incomplete}</MessageBar>
                            )}
                        </div>
                    )}
                    {(selectedQueryId === "dmv.waitStats" ||
                        selectedQueryId === "dmv.waitStatsAzure") && (
                        <MessageBar>{LocConstants.getInstance().sqlWaits.context}</MessageBar>
                    )}

                    <div
                        className={styles.gridWrap}
                        hidden={section === "querystore" && !queryStore?.canReadHistory}>
                        {result && result.rows.length > 0 ? (
                            result.queryId === "agent.jobHistory" ? (
                                <JobHistoryResults
                                    key={`${result.queryId}:${result.ranAt}`}
                                    result={result}
                                    themeKind={context.themeKind}
                                    openText={(rowIndex, field) =>
                                        context.openResultText(result.ranAt, rowIndex, field)
                                    }
                                />
                            ) : (
                                <DiagnosticsResults
                                    key={`${result.queryId}:${result.ranAt}`}
                                    result={result}
                                    themeKind={context.themeKind}
                                    openText={(rowIndex, field) =>
                                        context.openResultText(result.ranAt, rowIndex, field)
                                    }
                                />
                            )
                        ) : (
                            <div className={styles.empty}>
                                {isLoading
                                    ? pageLoc.running
                                    : selectedQueryId
                                      ? pageLoc.noRows
                                      : pageLoc.chooseInvestigation}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <NewJobDialog
                open={showNewJob}
                defaultDatabase={server?.database ?? ""}
                onClose={() => setShowNewJob(false)}
                onCreate={(request) => context.createJob(request)}
            />
            {showQueryStoreSettings && queryStore && (
                <QueryStoreSettings
                    state={queryStore}
                    error={errorMessage}
                    busy={isLoading}
                    close={() => setShowQueryStoreSettings(false)}
                    review={(configuration) => context.setQueryStore(true, configuration)}
                />
            )}
        </div>
    );
};

export default SqlDiagnosticsPage;
