/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    BadgeProps,
    Caption1,
    Link,
    makeStyles,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import type {
    AutomaticTuningOption,
    TuningRecommendation,
} from "../../../sharedInterfaces/performance";
import {
    GetAutomaticTuningRequest,
    OpenSqlScriptRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { dateTimeFormat, formatNumber } from "./performanceDashboardFormat";
import { SectionHeader, StatusBar, readData } from "./performanceDashboardParts";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { SimpleGrid } from "./performanceDashboardSimpleGrid";
import { TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";

const useStyles = makeStyles({
    view: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
    },
    note: {
        color: tokens.colorNeutralForeground3,
    },
    target: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
});

/**
 * Automatic tuning, read-only: the options (wanted and actual state) and the recommendations
 * with their state and history. Azure SQL Database and SQL database in Fabric.
 */
export const PerformanceDashboardAutoIndexView = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const tuning = useExtensionRequest(GetAutomaticTuningRequest.type, undefined, [
        databaseName,
        refreshKey,
    ]);

    const message = readStatusMessage(tuning);
    if (message) {
        return <StatusBar message={message} />;
    }
    const data = readData(tuning);
    if (!data) {
        return tuning.loading ? <TableSkeleton rows={3} /> : null;
    }
    const openScript = (sql: string) =>
        void extensionRpc.sendRequest(OpenSqlScriptRequest.type, { sql });

    return (
        <div className={classes.view}>
            <SectionHeader title={text.automaticTuningOptions} />
            <SimpleGrid<AutomaticTuningOption>
                items={data.options}
                getRowId={(option) => option.name}
                ariaLabel={text.automaticTuningOptions}
                columns={[
                    {
                        id: "option",
                        header: text.option,
                        idealWidth: 220,
                        render: (option) => tuningOptionLabel(option.name),
                    },
                    {
                        id: "desired",
                        header: text.desiredState,
                        render: (option) => option.desiredState ?? "—",
                    },
                    {
                        id: "actual",
                        header: text.actualState,
                        render: (option) => option.actualState ?? "—",
                    },
                    {
                        id: "reason",
                        header: text.reason,
                        idealWidth: 220,
                        render: (option) => option.reason ?? "",
                    },
                ]}
            />
            <SectionHeader title={text.recommendations}>
                {formatNumber(data.recommendations.length)}
            </SectionHeader>
            {data.recommendations.length === 0 ? (
                <Caption1 className={classes.note}>{text.noRecommendations}</Caption1>
            ) : (
                <SimpleGrid<TuningRecommendation>
                    items={data.recommendations}
                    getRowId={(recommendation) => recommendation.name}
                    ariaLabel={text.recommendations}
                    columns={[
                        {
                            id: "type",
                            header: text.recommendationType,
                            idealWidth: 140,
                            render: (recommendation) =>
                                recommendationTypeLabel(recommendation.type),
                            compare: (left, right) =>
                                (left.type ?? "").localeCompare(right.type ?? ""),
                        },
                        {
                            id: "target",
                            header: text.recommendationTarget,
                            idealWidth: 360,
                            minWidth: 200,
                            render: (recommendation) => (
                                <RecommendationTarget recommendation={recommendation} />
                            ),
                        },
                        {
                            id: "state",
                            header: text.recommendationState,
                            idealWidth: 120,
                            render: (recommendation) => <StateBadge state={recommendation.state} />,
                            compare: (left, right) =>
                                (left.state ?? "").localeCompare(right.state ?? ""),
                        },
                        {
                            id: "validSince",
                            header: text.validSince,
                            idealWidth: 160,
                            render: (recommendation) =>
                                recommendation.validSince
                                    ? dateTimeFormat.format(new Date(recommendation.validSince))
                                    : "—",
                            compare: (left, right) =>
                                Date.parse(left.validSince ?? "") -
                                Date.parse(right.validSince ?? ""),
                        },
                        {
                            id: "initiatedBy",
                            header: text.appliedBy,
                            idealWidth: 120,
                            render: (recommendation) =>
                                recommendation.revertActionInitiatedBy ??
                                recommendation.executeActionInitiatedBy ??
                                "—",
                        },
                        {
                            id: "script",
                            header: text.script,
                            idealWidth: 100,
                            render: (recommendation) =>
                                recommendation.script ? (
                                    <Link onClick={() => openScript(recommendation.script!)}>
                                        {text.openScript}
                                    </Link>
                                ) : (
                                    "—"
                                ),
                        },
                    ]}
                />
            )}
            <Caption1 className={classes.note}>{text.automaticTuningRules}</Caption1>
        </div>
    );
};

const RecommendationTarget = ({ recommendation }: { recommendation: TuningRecommendation }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { router, navigate } = useNavigation<PerformanceDashboardRoute>();
    const { index, plan } = recommendation;
    if (index) {
        const table = [index.schema, index.table].filter(Boolean).join(".");
        const columns = [
            index.indexColumns,
            index.includedColumns && `INCLUDE ${index.includedColumns}`,
        ]
            .filter(Boolean)
            .join(" ");
        return (
            <span className={classes.target}>
                <span>{[table, index.indexName].filter(Boolean).join(" · ") || "—"}</span>
                {columns && (
                    <Caption1 className={classes.secondary} title={columns}>
                        {columns}
                    </Caption1>
                )}
            </span>
        );
    }
    if (plan?.queryId) {
        const location = router.build("query", { queryId: plan.queryId }, { tab: "plans" });
        return (
            <span className={classes.target}>
                <Link
                    href={`#${location}`}
                    onClick={(event) => {
                        event.preventDefault();
                        navigate(location);
                    }}>
                    {text.query(plan.queryId)}
                </Link>
                {plan.regressedPlanId && plan.recommendedPlanId && (
                    <Caption1 className={classes.secondary}>
                        {text.planFromTo(plan.regressedPlanId, plan.recommendedPlanId)}
                    </Caption1>
                )}
            </span>
        );
    }
    return (
        <span className={classes.secondary} title={recommendation.details}>
            {recommendation.reason ?? recommendation.name}
        </span>
    );
};

const stateColors: Readonly<Record<string, BadgeProps["color"]>> = {
    Active: "brand",
    Verifying: "warning",
    Success: "success",
    Reverted: "danger",
    Expired: "informative",
};

const StateBadge = ({ state }: { state: string | undefined }) =>
    state ? (
        <Badge appearance="tint" shape="rounded" color={stateColors[state] ?? "informative"}>
            {state}
        </Badge>
    ) : (
        <>—</>
    );

function tuningOptionLabel(name: string): string {
    const text = loc.performanceDashboard;
    switch (name.toUpperCase()) {
        case "CREATE_INDEX":
            return text.createIndex;
        case "DROP_INDEX":
            return text.dropIndex;
        case "FORCE_LAST_GOOD_PLAN":
            return text.forceLastGoodPlan;
        default:
            return name;
    }
}

function recommendationTypeLabel(type: string | undefined): string {
    const text = loc.performanceDashboard;
    switch (type?.toUpperCase()) {
        case "CREATEINDEX":
        case "CREATE_INDEX":
            return text.createIndex;
        case "DROPINDEX":
        case "DROP_INDEX":
            return text.dropIndex;
        case "FORCE_LAST_GOOD_PLAN":
        case "FORCELASTGOODPLAN":
            return text.forceLastGoodPlan;
        default:
            return type ?? "—";
    }
}
