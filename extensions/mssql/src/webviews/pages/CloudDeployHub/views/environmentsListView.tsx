/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, makeStyles, Text, tokens } from "@fluentui/react-components";
import { PlayRegular } from "@fluentui/react-icons";
import * as React from "react";
import { locConstants } from "../../../common/locConstants";
import { useCloudDeployHubContext } from "../cloudDeployHubStateProvider";
import { useCloudDeployHubSelector } from "../cloudDeployHubSelector";
import { StatusBadge } from "../components/statusBadge";
import { sourceKindLabel } from "../components/humanize";
import { formatStartedShort } from "./formatUtils";

const useStyles = makeStyles({
    heading: {
        fontSize: "18px",
        fontWeight: 600,
        marginBottom: "16px",
        display: "block",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        fontSize: "13px",
    },
    card: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 14px",
        marginBottom: "8px",
        borderRadius: "4px",
        backgroundColor: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        cursor: "pointer",
    },
    cardMain: {
        flex: "1 1 auto",
        minWidth: 0,
    },
    nameRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "2px",
    },
    name: {
        fontSize: "14px",
        fontWeight: 600,
    },
    detail: {
        display: "block",
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    statusCol: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "4px",
        flexShrink: 0,
    },
    lastRun: {
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
    },
});

/**
 * Landing page listing every declared environment as a clickable card. Each
 * card shows the source of truth, the latest run status, and a Validate
 * button. Clicking the card opens that environment's detail page; clicking
 * Validate dispatches the validation pipeline against it.
 */
export const EnvironmentsListView: React.FC = () => {
    const classes = useStyles();
    const { navigate, runValidation } = useCloudDeployHubContext();
    const environments = useCloudDeployHubSelector((s) => s.environments);
    const runs = useCloudDeployHubSelector((s) => s.runs);
    const defaultEnvId = useCloudDeployHubSelector((s) => s.defaultEnvId);
    const strings = locConstants.cloudDeployHub;

    if (environments.length === 0) {
        return <div className={classes.empty}>{strings.environmentListEmpty}</div>;
    }

    return (
        <div>
            <Text as="h2" className={classes.heading}>
                {strings.environmentListHeading}
            </Text>
            {environments.map((env) => {
                const latest = runs.find((r) => r.envId === env.id);
                return (
                    <div
                        key={env.id}
                        className={classes.card}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate("environment", { envId: env.id })}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                navigate("environment", { envId: env.id });
                            }
                        }}>
                        <div className={classes.cardMain}>
                            <div className={classes.nameRow}>
                                <Text className={classes.name}>{env.name}</Text>
                                {defaultEnvId === env.id ? (
                                    <Badge appearance="tint" color="brand" size="small">
                                        {strings.environmentListDefaultBadge}
                                    </Badge>
                                ) : null}
                            </div>
                            <Text className={classes.detail}>
                                {sourceKindLabel(env.sourceOfTruthKind)}
                            </Text>
                        </div>
                        <div className={classes.statusCol}>
                            {latest ? (
                                <>
                                    <StatusBadge status={latest.status} />
                                    <span className={classes.lastRun}>
                                        {strings.environmentListLastRun}:{" "}
                                        {formatStartedShort(latest.startedAtMs)}
                                    </span>
                                </>
                            ) : (
                                <span className={classes.lastRun}>
                                    {strings.environmentListNoRuns}
                                </span>
                            )}
                        </div>
                        <Button
                            appearance="primary"
                            size="small"
                            icon={<PlayRegular />}
                            onClick={(e) => {
                                e.stopPropagation();
                                runValidation(env.id);
                            }}>
                            {strings.environmentListValidate}
                        </Button>
                    </div>
                );
            })}
        </div>
    );
};
