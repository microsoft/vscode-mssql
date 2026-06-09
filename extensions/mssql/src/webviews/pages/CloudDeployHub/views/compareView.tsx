/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, makeStyles, Text, tokens } from "@fluentui/react-components";
import { ArrowLeftRegular, ArrowRightRegular } from "@fluentui/react-icons";
import * as React from "react";
import { ValidationDelta } from "../../../../cloudDeploy/runs/runComparison";
import { locConstants } from "../../../common/locConstants";
import { useCloudDeployHubContext } from "../cloudDeployHubStateProvider";
import { useCloudDeployHubSelector } from "../cloudDeployHubSelector";

const useStyles = makeStyles({
    backRow: {
        marginBottom: "12px",
    },
    heading: {
        fontSize: "16px",
        fontWeight: 600,
        marginBottom: "8px",
    },
    runsLine: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        marginBottom: "16px",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "13px",
    },
    th: {
        textAlign: "left",
        padding: "6px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: tokens.colorNeutralForeground3,
    },
    td: {
        padding: "8px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        verticalAlign: "top",
    },
    changed: {
        color: tokens.colorPaletteYellowForeground1,
        fontWeight: 600,
    },
    changedRow: {
        backgroundColor: tokens.colorNeutralBackground2,
    },
    statusCell: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
    arrow: {
        display: "flex",
        alignItems: "center",
        color: tokens.colorNeutralForeground3,
    },
    deltaUp: {
        color: tokens.colorPaletteRedForeground1,
        fontWeight: 600,
    },
    deltaDown: {
        color: tokens.colorPaletteGreenForeground1,
        fontWeight: 600,
    },
    deltaSame: {
        color: tokens.colorNeutralForeground3,
    },
    onlyOne: {
        color: tokens.colorNeutralForeground3,
        fontStyle: "italic",
    },
    empty: {
        padding: "24px",
        textAlign: "center",
        color: tokens.colorNeutralForeground3,
    },
});

function formatDelta(delta: number): string {
    return delta > 0 ? `+${delta}` : String(delta);
}

const PRESENCE_DASH = "—";

export const CompareView: React.FC = () => {
    const classes = useStyles();
    const { navigate } = useCloudDeployHubContext();
    const comparison = useCloudDeployHubSelector((s) => s.comparison);
    const strings = locConstants.cloudDeployHub;

    if (!comparison) {
        return (
            <div className={classes.empty}>
                <Text>{strings.compareSelectHint}</Text>
                <div style={{ marginTop: "12px" }}>
                    <Button
                        appearance="subtle"
                        icon={<ArrowLeftRegular />}
                        size="small"
                        onClick={() => navigate("runList")}>
                        {strings.backToList}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className={classes.backRow}>
                <Button
                    appearance="subtle"
                    icon={<ArrowLeftRegular />}
                    size="small"
                    onClick={() => navigate("runList")}>
                    {strings.backToList}
                </Button>
            </div>
            <Text as="h2" className={classes.heading}>
                {strings.compareHeading}
            </Text>
            <div className={classes.runsLine}>
                {strings.compareColRunA}: {comparison.runIdA.slice(0, 8)} (
                {comparison.environmentNameA}) {PRESENCE_DASH} {strings.compareColRunB}:{" "}
                {comparison.runIdB.slice(0, 8)} ({comparison.environmentNameB})
            </div>
            <table className={classes.table}>
                <thead>
                    <tr>
                        <th className={classes.th}>{strings.compareColValidation}</th>
                        <th className={classes.th}>{strings.compareColRunA}</th>
                        <th className={classes.th}>{strings.compareColRunB}</th>
                        <th className={classes.th}>{strings.compareColFindings}</th>
                        <th className={classes.th}>{strings.compareColDuration}</th>
                        <th className={classes.th}></th>
                    </tr>
                </thead>
                <tbody>
                    {comparison.validations.map((delta) => (
                        <CompareRow key={delta.validationId} delta={delta} />
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const CompareRow: React.FC<{ delta: ValidationDelta }> = ({ delta }) => {
    const classes = useStyles();
    const strings = locConstants.cloudDeployHub;

    const statusANode =
        delta.presence === "only-b" ? (
            <span className={classes.onlyOne}>{PRESENCE_DASH}</span>
        ) : (
            <span className={delta.statusChanged ? classes.changed : undefined}>
                {delta.statusA}
            </span>
        );
    const statusBNode =
        delta.presence === "only-a" ? (
            <span className={classes.onlyOne}>{PRESENCE_DASH}</span>
        ) : (
            <span className={delta.statusChanged ? classes.changed : undefined}>
                {delta.statusB}
            </span>
        );

    const findingsNode =
        delta.presence === "both" ? (
            <span>
                {delta.findingCountA} <ArrowRightRegular fontSize={12} /> {delta.findingCountB}{" "}
                <span
                    className={
                        delta.findingCountDelta > 0
                            ? classes.deltaUp
                            : delta.findingCountDelta < 0
                              ? classes.deltaDown
                              : classes.deltaSame
                    }>
                    ({formatDelta(delta.findingCountDelta)})
                </span>
            </span>
        ) : delta.presence === "only-a" ? (
            <span className={classes.onlyOne}>{strings.compareOnlyA}</span>
        ) : (
            <span className={classes.onlyOne}>{strings.compareOnlyB}</span>
        );

    const durationNode =
        delta.durationDeltaMs !== undefined ? (
            <span>{strings.compareDeltaMs(delta.durationDeltaMs)}</span>
        ) : (
            <span className={classes.onlyOne}>{PRESENCE_DASH}</span>
        );

    const changeBadge = delta.statusChanged ? (
        <Badge appearance="filled" color="warning">
            {strings.compareChanged}
        </Badge>
    ) : delta.presence === "both" ? (
        <Badge appearance="outline" color="informative">
            {strings.compareUnchanged}
        </Badge>
    ) : null;

    return (
        <tr className={delta.statusChanged ? classes.changedRow : undefined}>
            <td className={classes.td}>{delta.displayName}</td>
            <td className={classes.td}>{statusANode}</td>
            <td className={classes.td}>{statusBNode}</td>
            <td className={classes.td}>{findingsNode}</td>
            <td className={classes.td}>{durationNode}</td>
            <td className={classes.td}>{changeBadge}</td>
        </tr>
    );
};
