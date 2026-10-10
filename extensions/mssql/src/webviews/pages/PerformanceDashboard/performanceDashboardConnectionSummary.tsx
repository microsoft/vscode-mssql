/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import { GetDatabaseFactsRequest } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import {
    DatabaseFactItem,
    databaseFactsItems,
    databaseFactsParts,
} from "./performanceDashboardOverviewModel";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

const useStyles = makeStyles({
    // Labeled values on one line; the line is cut at the end when the header is narrow.
    root: {
        display: "flex",
        alignItems: "baseline",
        columnGap: "24px",
        minWidth: 0,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
    },
    item: {
        display: "inline-flex",
        alignItems: "baseline",
        columnGap: "6px",
        minWidth: 0,
    },
    // VS Code's muted text, which stands apart from the values in every theme.
    label: {
        color: "var(--vscode-descriptionForeground)",
    },
    value: {
        color: "var(--vscode-foreground)",
        fontWeight: tokens.fontWeightMedium,
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
    failed: {
        color: tokens.colorPaletteRedForeground1,
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
});

/** The server, and the version, tier, and size of the database, as labeled values. */
export const PerformanceDashboardConnectionSummary = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    // The "tcp:" protocol prefix of a connection string says nothing to the user.
    const serverName = usePerformanceDashboardSelector((state) =>
        state.serverName.replace(/^tcp:/i, ""),
    );
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const facts = useExtensionRequest(GetDatabaseFactsRequest.type, undefined, databaseName);

    const errorMessage = facts.result?.errorMessage ?? facts.errorMessage;
    const failed = errorMessage ? text.connectionFailed(errorMessage) : "";
    const items: DatabaseFactItem[] = [
        { label: text.serverLabel, value: serverName },
        ...databaseFactsItems(facts.result),
    ];
    const title = [serverName, failed || databaseFactsParts(facts.result).join(" · ")]
        .filter(Boolean)
        .join(" · ");

    return (
        <div className={classes.root} title={title}>
            {items.map((item) => (
                <span key={item.label} className={classes.item}>
                    <span className={classes.label}>{item.label}</span>
                    <span className={classes.value}>{item.value}</span>
                </span>
            ))}
            {failed && <span className={classes.failed}>{failed}</span>}
        </div>
    );
};
