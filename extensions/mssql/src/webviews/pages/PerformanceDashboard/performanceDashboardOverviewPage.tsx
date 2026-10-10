/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import {
    DatabaseFactsResult,
    GetDatabaseFactsRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { SegmentedControl } from "../../common/segmentedControl";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { chartCardChartHeight } from "./performanceDashboardParts";
import { QueryListSection } from "./performanceDashboardQueryListSection";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import {
    OverviewSegment,
    SegmentSpec,
    overviewSegmentParameter,
    overviewSegmentsFor,
} from "./performanceDashboardSegments";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { ChartCardSkeleton, TableSkeleton, ValueSkeleton } from "./performanceDashboardSkeletons";

const useStyles = makeStyles({
    // Grows to the bottom of the page, so the query grid can fill the space left.
    root: {
        display: "flex",
        flexDirection: "column",
        flex: "1 0 auto",
        alignItems: "stretch",
        gap: "16px",
    },
    segments: {
        alignSelf: "flex-start",
    },
});

/**
 * The overview: a segment picker and the selected segment. The segments depend on the platform,
 * and the selected one is in the location, for example `overview?metric=memory`.
 */
export const PerformanceDashboardOverviewPage = () => {
    const classes = useStyles();
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const facts = useExtensionRequest(GetDatabaseFactsRequest.type, undefined, databaseName);

    // Until the platform is known, the shape of the overview: segments, chart card, and grid.
    const requested = match.query[overviewSegmentParameter] as OverviewSegment | undefined;
    if (facts.loading && !facts.result) {
        return (
            <div className={classes.root}>
                <ValueSkeleton width={420} height={24} />
                <ChartCardSkeleton chartHeight={chartCardChartHeight} />
                <TableSkeleton />
            </div>
        );
    }
    const specs = overviewSegmentsFor(facts.result);
    const spec = specs.find((candidate) => candidate.id === requested) ?? specs[0];

    return (
        <div className={classes.root}>
            {specs.length > 1 && (
                <SegmentedControl<OverviewSegment>
                    className={classes.segments}
                    size="small"
                    ariaLabel={loc.performanceDashboard.metric}
                    value={spec.id}
                    options={specs.map((candidate) => ({
                        value: candidate.id,
                        label: candidate.label(),
                    }))}
                    onValueChange={(value) =>
                        navigate(
                            router.build(
                                "overview",
                                {},
                                {
                                    ...match.query,
                                    [overviewSegmentParameter]:
                                        value === specs[0].id ? undefined : value,
                                },
                            ),
                        )
                    }
                />
            )}
            {spec && <SegmentView key={spec.id} spec={spec} facts={facts.result} />}
        </div>
    );
};

/** A segment: its own view, or its panel and its top queries. */
const SegmentView = ({
    spec,
    facts,
}: {
    spec: SegmentSpec;
    facts: DatabaseFactsResult | undefined;
}) => {
    if (spec.view) {
        const View = spec.view;
        return <View facts={facts} />;
    }
    const Panel = spec.panel?.(facts);
    return (
        <>
            {Panel && <Panel facts={facts} />}
            {spec.queryList && <QueryListSection spec={spec.queryList} />}
        </>
    );
};
