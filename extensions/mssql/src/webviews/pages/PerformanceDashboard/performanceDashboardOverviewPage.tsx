/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands, Spinner } from "@fluentui/react-components";
import { GetDatabaseFactsRequest } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { SegmentedControl } from "../../common/segmentedControl";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { PerformanceDashboardAutoIndexView } from "./performanceDashboardAutoIndexView";
import { PerformanceDashboardBlockedView } from "./performanceDashboardBlockedView";
import { PerformanceDashboardConnectionsView } from "./performanceDashboardConnectionsView";
import { PerformanceDashboardCpuView } from "./performanceDashboardCpuView";
import { PerformanceDashboardMemoryView } from "./performanceDashboardMemoryView";
import { PerformanceDashboardRequestsView } from "./performanceDashboardRequestsView";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import {
    OverviewSegment,
    overviewSegmentLabel,
    overviewSegmentParameter,
    overviewSegmentsFor,
} from "./performanceDashboardSegments";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        ...shorthands.gap("16px"),
    },
    segments: {
        alignSelf: "flex-start",
    },
});

/**
 * The overview: a segment picker and the view of the segment. The segments depend on the
 * platform, and the selected one is in the location, for example `overview?metric=memory`.
 */
export const PerformanceDashboardOverviewPage = () => {
    const classes = useStyles();
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const facts = useExtensionRequest(GetDatabaseFactsRequest.type, undefined, databaseName);

    if (facts.loading && !facts.result) {
        return <Spinner size="small" label={loc.common.loading} />;
    }
    const segments = overviewSegmentsFor(facts.result?.platform, facts.result?.majorVersion);
    const requested = match.query[overviewSegmentParameter] as OverviewSegment | undefined;
    const segment = requested && segments.includes(requested) ? requested : segments[0];

    return (
        <div className={classes.root}>
            {segments.length > 1 && (
                <SegmentedControl<OverviewSegment>
                    className={classes.segments}
                    size="small"
                    ariaLabel={loc.performanceDashboard.metric}
                    value={segment}
                    options={segments.map((value) => ({
                        value,
                        label: overviewSegmentLabel(value),
                    }))}
                    onValueChange={(value) =>
                        navigate(
                            router.build(
                                "overview",
                                {},
                                {
                                    ...match.query,
                                    [overviewSegmentParameter]:
                                        value === segments[0] ? undefined : value,
                                },
                            ),
                        )
                    }
                />
            )}
            {segment === "cpu" && <PerformanceDashboardCpuView />}
            {segment === "memory" && <PerformanceDashboardMemoryView />}
            {segment === "connections" && <PerformanceDashboardConnectionsView />}
            {segment === "requests" && <PerformanceDashboardRequestsView />}
            {segment === "blocked" && <PerformanceDashboardBlockedView />}
            {segment === "autoIndex" && <PerformanceDashboardAutoIndexView />}
        </div>
    );
};
