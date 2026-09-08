/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useState } from "react";
import { Text } from "@fluentui/react-components";
import { groupJobHistory } from "sql-feature/agent";
import type { ColorThemeKind } from "../../../sharedInterfaces/webview";
import type { DiagnosticsResult } from "../../../sharedInterfaces/sqlDiagnostics";
import { DiagnosticsResults } from "./diagnosticsResults";
import { LocConstants } from "../../common/locConstants";

export function JobHistoryResults({
    result,
    themeKind,
    openText,
}: {
    result: DiagnosticsResult;
    themeKind?: ColorThemeKind;
    openText: (index: number, field: string) => void;
}) {
    const loc = LocConstants.getInstance().agentHistory;
    const groups = useMemo(() => groupJobHistory(result.rows), [result]);
    const [selected, setSelected] = useState<number>();
    const executions = useMemo<DiagnosticsResult>(
        () => ({
            ...result,
            columns: [
                { field: "run_time", header: loc.started, format: "datetime" },
                { field: "run_status", header: loc.outcome },
                { field: "run_duration_ms", header: loc.duration, format: "duration-ms" },
                { field: "retained_steps", header: loc.attempts, format: "number" },
            ],
            rows: groups.map((group) => ({
                ...(group.summaryIndex === undefined
                    ? { run_status: loc.unassigned }
                    : result.rows[group.summaryIndex]),
                retained_steps: group.stepIndexes.length,
            })),
        }),
        [result, groups, loc.started, loc.outcome, loc.duration, loc.attempts, loc.unassigned],
    );
    const group = selected === undefined ? undefined : groups[selected];
    const indexes = group?.stepIndexes ?? [];
    const steps: DiagnosticsResult = {
        ...result,
        rows: indexes.map((index) => result.rows[index]),
    };
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minHeight: 0,
                gap: 8,
            }}>
            <Text>{loc.retention}</Text>
            <div style={{ flex: "1 1 45%", minHeight: 150 }}>
                <DiagnosticsResults
                    result={executions}
                    themeKind={themeKind}
                    showInspector={false}
                    onSelectRow={setSelected}
                    openText={() => {}}
                />
            </div>
            {group && (
                <>
                    <Text weight="semibold">{loc.steps}</Text>
                    {group.summaryIndex !== undefined && (
                        <Text>{String(result.rows[group.summaryIndex].message ?? "")}</Text>
                    )}
                    {indexes.length ? (
                        <div style={{ flex: "1 1 55%", minHeight: 180 }}>
                            <DiagnosticsResults
                                key={selected}
                                result={steps}
                                themeKind={themeKind}
                                openText={(index, field) => openText(indexes[index], field)}
                            />
                        </div>
                    ) : (
                        <Text>{loc.noSteps}</Text>
                    )}
                </>
            )}
        </div>
    );
}
