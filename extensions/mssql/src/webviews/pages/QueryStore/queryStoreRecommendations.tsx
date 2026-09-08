/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageBar, Text, makeStyles, tokens } from "@fluentui/react-components";
import { cellDisplayText, type DiagnosticsResult } from "../../../sharedInterfaces/sqlDiagnostics";
import { LocConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    label: { color: tokens.colorNeutralForeground3 },
});

export function QueryStoreRecommendations({ result }: { result: DiagnosticsResult | undefined }) {
    const styles = useStyles();
    const loc = LocConstants.getInstance().sqlFeaturePage.queryStore;

    if (!result || !result.queryId.startsWith("qds.") || result.rows.length === 0) {
        return undefined;
    }

    const row = result.rows[0];
    const queryId = stringValue(row.query_id);
    if (!queryId) return undefined;

    let observation: string | undefined;
    let nextCheck: string | undefined;
    let coverage: string | undefined;
    switch (result.queryId) {
        case "qds.regressedQueries": {
            const factor = numberValue(row.regression_factor);
            const recentExecutions = numberValue(row.recent_executions);
            const baselineExecutions = numberValue(row.baseline_executions);
            if (
                factor === undefined ||
                recentExecutions === undefined ||
                baselineExecutions === undefined
            ) {
                return undefined;
            }
            observation = loc.regressionObservation(
                queryId,
                formatNumber(factor),
                formatNumber(recentExecutions),
                formatNumber(baselineExecutions),
            );
            nextCheck = loc.regressionNextCheck;
            coverage = coverageText(
                row,
                "recent_observed_interval_count",
                "recent_available_interval_count",
                loc.coverageLimitation,
            );
            if (!coverage) {
                coverage = coverageText(
                    row,
                    "baseline_observed_interval_count",
                    "baseline_available_interval_count",
                    loc.coverageLimitation,
                );
            }
            break;
        }
        case "qds.highVariation": {
            const coefficient = numberValue(row.variation_coefficient);
            const executions = numberValue(row.executions);
            if (coefficient === undefined || executions === undefined) return undefined;
            observation = loc.variationObservation(
                queryId,
                formatNumber(coefficient),
                formatNumber(executions),
            );
            nextCheck = loc.variationNextCheck;
            coverage = coverageText(
                row,
                "observed_interval_count",
                "available_interval_count",
                loc.coverageLimitation,
            );
            break;
        }
        case "qds.waitStats": {
            const total = numberValue(row.total_wait_ms);
            const average = numberValue(row.avg_wait_ms);
            const executions = numberValue(row.executions);
            const category = stringValue(row.wait_category_desc) ?? stringValue(row.wait_category);
            if (
                total === undefined ||
                average === undefined ||
                executions === undefined ||
                !category
            ) {
                return undefined;
            }
            observation = loc.waitObservation(
                queryId,
                category,
                `${formatNumber(total)} ms`,
                `${formatNumber(average)} ms`,
                formatNumber(executions),
            );
            nextCheck = loc.waitNextCheck;
            coverage = coverageText(
                row,
                "observed_interval_count",
                "available_interval_count",
                loc.coverageLimitation,
            );
            break;
        }
        default:
            return undefined;
    }

    if (!observation || !nextCheck) return undefined;
    return (
        <section className={styles.root} aria-label={loc.recommendationsTitle}>
            <Text weight="semibold">{loc.recommendationsTitle}</Text>
            <MessageBar intent="info">{observation}</MessageBar>
            <Text className={styles.label} size={200} weight="semibold">
                {loc.nextCheck}
            </Text>
            <Text size={200}>{nextCheck}</Text>
            {coverage && (
                <>
                    <Text className={styles.label} size={200} weight="semibold">
                        {loc.limitation}
                    </Text>
                    <Text size={200}>{coverage}</Text>
                </>
            )}
        </section>
    );
}

function numberValue(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
    const text = cellDisplayText(value).trim();
    return text.length > 0 ? text : undefined;
}

function formatNumber(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function coverageText(
    row: Record<string, unknown>,
    observedField: string,
    availableField: string,
    format: (observed: string, available: string) => string,
): string | undefined {
    const observed = numberValue(row[observedField]);
    const available = numberValue(row[availableField]);
    return observed !== undefined && available !== undefined && observed < available
        ? format(formatNumber(observed), formatNumber(available))
        : undefined;
}
