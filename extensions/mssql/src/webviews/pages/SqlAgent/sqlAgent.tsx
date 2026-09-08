/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    Button,
    Dropdown,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
} from "@fluentui/react-components";
import { Play16Regular, Stop16Regular } from "@fluentui/react-icons";

import { LocConstants } from "../../common/locConstants";
import { SqlDiagnosticsContext } from "../SqlDiagnostics/sqlDiagnosticsStateProvider";
import { useSqlDiagnosticsSelector } from "../SqlDiagnostics/sqlDiagnosticsSelector";
import { AgentReadinessPanel } from "../SqlDiagnostics/agentReadiness";
import { NewJobDialog } from "../SqlDiagnostics/sqlDiagnostics";
import {
    SqlFeatureNavigationItem,
    SqlFeaturePageFrame,
} from "../SqlDiagnostics/sqlFeaturePageFrame";

export default function SqlAgentPage() {
    const context = useContext(SqlDiagnosticsContext);
    const loc = LocConstants.getInstance();
    const pageLoc = loc.sqlFeaturePage;
    const server = useSqlDiagnosticsSelector((state) => state.server);
    const readiness = useSqlDiagnosticsSelector((state) => state.agentReadiness);
    const readinessBusy = useSqlDiagnosticsSelector((state) => state.agentReadinessBusy);
    const actionBusy = useSqlDiagnosticsSelector((state) => state.jobActionBusy);
    const selectedQueryId = useSqlDiagnosticsSelector((state) => state.selectedQueryId);
    const selectedJobId = useSqlDiagnosticsSelector((state) => state.selectedJobId);
    const jobOptions = useSqlDiagnosticsSelector((state) => state.jobOptions);
    const [showNewJob, setShowNewJob] = useState(false);
    const [jobToManage, setJobToManage] = useState<string | undefined>(selectedJobId);
    const navigation: readonly SqlFeatureNavigationItem[] = [
        {
            id: "overview",
            queryId: "agent.jobs",
            label: pageLoc.agent.overview,
            description: pageLoc.agent.overviewDescription,
        },
        {
            id: "running",
            queryId: "agent.runningJobs",
            label: pageLoc.agent.running,
            description: pageLoc.agent.runningDescription,
        },
        {
            id: "status",
            queryId: "agent.status",
            label: pageLoc.agent.status,
            description: pageLoc.agent.statusDescription,
        },
        {
            id: "steps",
            queryId: "agent.jobSteps",
            label: pageLoc.agent.steps,
            description: pageLoc.agent.stepsDescription,
        },
        {
            id: "history",
            queryId: "agent.jobHistory",
            label: pageLoc.agent.history,
            description: pageLoc.agent.historyDescription,
        },
    ];
    const target = jobToManage ?? selectedJobId;
    const canManage = selectedQueryId === "agent.jobs" && target !== undefined && context;
    const toolbar = (
        <>
            <Dropdown
                aria-label={pageLoc.agent.chooseJob}
                placeholder={pageLoc.agent.chooseJob}
                selectedOptions={target ? [target] : []}
                value={jobOptions.find((job) => job.id === target)?.name ?? ""}
                onOptionSelect={(_, data) => {
                    setJobToManage(data.optionValue);
                    if (data.optionValue) context?.selectJob(data.optionValue);
                }}>
                {jobOptions.map((job) => (
                    <Option key={job.id} value={job.id}>
                        {job.name}
                    </Option>
                ))}
            </Dropdown>
            {canManage && (
                <>
                    <Button
                        icon={<Play16Regular />}
                        appearance="subtle"
                        disabled={actionBusy || readiness?.service === "stopped"}
                        onClick={() => context?.jobAction(target!, "start")}>
                        {pageLoc.agent.start}
                    </Button>
                    <Button
                        icon={<Stop16Regular />}
                        appearance="subtle"
                        disabled={actionBusy || readiness?.service === "stopped"}
                        onClick={() => context?.jobAction(target!, "stop")}>
                        {pageLoc.agent.stop}
                    </Button>
                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <Button disabled={actionBusy}>{pageLoc.agent.manage}</Button>
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                {(["enable", "disable", "delete"] as const).map((action) => (
                                    <MenuItem
                                        key={action}
                                        onClick={() => context?.jobAction(target!, action)}>
                                        {loc.agentActions[action]}
                                    </MenuItem>
                                ))}
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                </>
            )}
            {server?.hasSqlAgent && (
                <Button appearance="subtle" onClick={() => setShowNewJob(true)}>
                    {pageLoc.agent.newJob}
                </Button>
            )}
        </>
    );

    return (
        <>
            <SqlFeaturePageFrame
                section="agent"
                title={loc.sqlFeatures.agent}
                subtitle={pageLoc.agent.overviewDescription}
                navigation={navigation}
                defaultQueryId="agent.jobs"
                toolbar={toolbar}
                summary={
                    readiness ? (
                        <AgentReadinessPanel
                            state={readiness}
                            busy={!!readinessBusy}
                            recheck={() => context?.recheckAgent()}
                        />
                    ) : undefined
                }
            />
            <NewJobDialog
                open={showNewJob}
                defaultDatabase={server?.database ?? ""}
                onClose={() => setShowNewJob(false)}
                onCreate={(request) => context?.createJob(request)}
            />
        </>
    );
}
