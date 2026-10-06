/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, makeStyles, tokens } from "@fluentui/react-components";
import { Lightbulb16Filled } from "@fluentui/react-icons";
import { CSSProperties } from "react";
import { ExecutionPlanGraph } from "../../../sharedInterfaces/executionPlan";
import { locConstants } from "../../common/locConstants";
import { SqlText } from "../../common/sqlText";
import {
    normalizeExecutionPlanQuery,
    parseRecommendationDisplayString,
} from "./executionPlanQuery";
import {
    formatLiveExecutionPlanDuration,
    formatLiveExecutionPlanProgress,
} from "./executionPlanLiveStatistics";

const useStyles = makeStyles({
    queryCostContainer: {
        opacity: 1,
        boxSizing: "border-box",
        flexShrink: 0,
        padding: "6px 8px 7px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    queryCostSummary: {
        color: tokens.colorNeutralForeground1,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase200,
        paddingBottom: "4px",
    },
    liveBadge: {
        marginLeft: "8px",
        verticalAlign: "middle",
    },
    queryText: {
        fontSize: "12px",
        lineHeight: "17px",
        maxHeight: "17px",
        paddingTop: "4px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    recommendations: {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        rowGap: "3px",
        paddingTop: "6px",
        // caps the header at roughly three recommendations before scrolling, so a plan
        // with many missing indexes doesn't squeeze the graph out of view
        maxHeight: "78px",
        overflowY: "auto",
    },
    recommendationButton: {
        display: "flex",
        justifyContent: "flex-start",
        alignItems: "center",
        columnGap: "6px",
        width: "100%",
        minWidth: 0,
        height: "auto",
        minHeight: "22px",
        padding: "2px 6px",
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorTransparentStroke}`,
        backgroundColor: tokens.colorNeutralBackground3,
        textAlign: "left",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground3Hover,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
        },
        ":hover:active": {
            backgroundColor: tokens.colorNeutralBackground3Pressed,
        },
    },
    recommendationIcon: {
        flexShrink: 0,
        color: tokens.colorPaletteYellowForeground2,
    },
    recommendationLabel: {
        flexShrink: 0,
        fontSize: "12px",
        lineHeight: "17px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    recommendationImpact: {
        flexShrink: 0,
    },
    recommendationScript: {
        flexGrow: 1,
        minWidth: 0,
        fontSize: "12px",
        lineHeight: "17px",
    },
});

/** Shared query summary, live statistics, and index recommendations for both plan views. */
export function ExecutionPlanHeader({
    graph,
    costLabel,
    onShowQuery,
    id,
    style,
}: {
    graph: ExecutionPlanGraph | undefined;
    costLabel: string;
    /** Opens a recommendation's script, wrapped in its explanatory comment, without running it. */
    onShowQuery: (query: string) => void;
    id?: string;
    style?: CSSProperties;
}) {
    const classes = useStyles();
    const query = normalizeExecutionPlanQuery(graph?.query ?? "");
    const recommendations = (graph?.recommendations ?? []).map((recommendation) => ({
        ...parseRecommendationDisplayString(recommendation.displayString),
        accessibleName: recommendation.displayString,
        queryWithDescription: recommendation.queryWithDescription,
    }));
    const estimatedProgress = graph?.liveQueryStatistics?.estimatedProgress;
    const progressLabel =
        estimatedProgress === undefined
            ? undefined
            : formatLiveExecutionPlanProgress(estimatedProgress);
    const liveElapsed = graph?.liveQueryStatistics?.elapsedTimeInMs;
    const elapsedLabel =
        liveElapsed === undefined
            ? undefined
            : locConstants.executionPlan.liveElapsedTime(
                  formatLiveExecutionPlanDuration(liveElapsed),
              );

    return (
        <div
            id={id}
            className={classes.queryCostContainer}
            style={{ background: tokens.colorNeutralBackground2, ...style }}
            aria-live="polite"
            aria-label={[
                costLabel,
                query,
                recommendations.length > 0
                    ? locConstants.executionPlan.missingIndexRecommendations
                    : undefined,
                progressLabel,
                elapsedLabel,
            ]
                .filter(Boolean)
                .join(", ")}>
            <div className={classes.queryCostSummary}>
                {costLabel}
                {graph?.isLive && (
                    <Badge
                        appearance="tint"
                        color="brand"
                        size="small"
                        className={classes.liveBadge}
                        title={locConstants.executionPlan.livePlanDescription}>
                        {locConstants.executionPlan.live}
                    </Badge>
                )}
                {progressLabel && (
                    <Badge
                        appearance="outline"
                        className={classes.liveBadge}
                        title={locConstants.executionPlan.liveEstimatedProgressDescription}>
                        {progressLabel}
                    </Badge>
                )}
                {elapsedLabel && <span className={classes.liveBadge}>{elapsedLabel}</span>}
            </div>
            <SqlText
                className={classes.queryText}
                text={query}
                singleLine
                showLineBreaks
                title={query}
            />
            {recommendations.length > 0 && (
                <div
                    className={classes.recommendations}
                    role="group"
                    aria-label={locConstants.executionPlan.missingIndexRecommendations}>
                    {recommendations.map((recommendation, index) => (
                        <Button
                            key={index}
                            appearance="subtle"
                            className={classes.recommendationButton}
                            icon={<Lightbulb16Filled className={classes.recommendationIcon} />}
                            aria-label={recommendation.accessibleName}
                            title={`${recommendation.accessibleName}\n\n${locConstants.executionPlan.openIndexRecommendationScript}`}
                            onClick={() => onShowQuery(recommendation.queryWithDescription)}>
                            <span className={classes.recommendationLabel}>
                                {locConstants.executionPlan.missingIndex}
                            </span>
                            {recommendation.impact !== undefined && (
                                <Badge
                                    appearance="tint"
                                    color="success"
                                    size="small"
                                    className={classes.recommendationImpact}>
                                    {locConstants.executionPlan.missingIndexImpact(
                                        recommendation.impact.toFixed(1),
                                    )}
                                </Badge>
                            )}
                            <SqlText
                                className={classes.recommendationScript}
                                text={recommendation.script}
                                singleLine
                            />
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}
