/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Divider, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { GetDatabaseFactsRequest } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { databaseFactsParts } from "./performanceDashboardOverviewModel";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

const useStyles = makeStyles({
    root: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("10px"),
        minWidth: 0,
    },
    status: {
        width: "8px",
        height: "8px",
        flexShrink: 0,
        ...shorthands.borderRadius("50%"),
    },
    connected: {
        backgroundColor: tokens.colorPaletteGreenForeground1,
    },
    connecting: {
        backgroundColor: tokens.colorNeutralForeground3,
    },
    failed: {
        backgroundColor: tokens.colorPaletteRedForeground1,
    },
    server: {
        flexShrink: 0,
        fontFamily: tokens.fontFamilyMonospace,
        color: tokens.colorNeutralForeground1,
    },
    divider: {
        flexGrow: 0,
        height: "16px",
    },
    facts: {
        minWidth: 0,
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
});

/** The connection status, the server, and the platform, tier, and size of the database. */
export const PerformanceDashboardConnectionSummary = () => {
    const classes = useStyles();
    const serverName = usePerformanceDashboardSelector((state) => state.serverName);
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const facts = useExtensionRequest(GetDatabaseFactsRequest.type, undefined, databaseName);

    const errorMessage = facts.result?.errorMessage ?? facts.errorMessage;
    const status = facts.loading
        ? { className: classes.connecting, label: loc.performanceDashboard.connecting }
        : errorMessage
          ? {
                className: classes.failed,
                label: loc.performanceDashboard.connectionFailed(errorMessage),
            }
          : { className: classes.connected, label: loc.performanceDashboard.connected };
    const factsLine = databaseFactsParts(facts.result).join(" · ");

    return (
        <div className={classes.root}>
            <span
                role="img"
                aria-label={status.label}
                title={status.label}
                className={mergeClasses(classes.status, status.className)}
            />
            <span className={classes.server}>{serverName}</span>
            {factsLine && (
                <>
                    <Divider vertical className={classes.divider} />
                    <span className={classes.facts} title={factsLine}>
                        {factsLine}
                    </span>
                </>
            )}
        </div>
    );
};
