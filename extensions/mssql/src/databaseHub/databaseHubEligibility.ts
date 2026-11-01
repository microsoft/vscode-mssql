/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Menu visibility for Open in Database Hub. Trees ask while they draw, so this reads only the
 * profile and the server facts saved from earlier connections.
 */

import type { TreeNodeContextValue } from "vscode-mssql";
import * as Constants from "../constants/constants";
import type { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import {
    DatabaseHubConnection,
    DatabaseHubEligibility,
    DatabaseHubServerFacts,
    classifyDatabaseHubTarget,
} from "./databaseHubTarget";

type ServerFactsSource = (
    connection: DatabaseHubConnection & { id: string },
) => DatabaseHubServerFacts | undefined;

let serverFactsSource: ServerFactsSource | undefined;

/** Lets menus read the server facts that the running extension saves. */
export function registerDatabaseHubServerFacts(source: ServerFactsSource): { dispose(): void } {
    serverFactsSource = source;
    return {
        dispose: () => {
            if (serverFactsSource === source) {
                serverFactsSource = undefined;
            }
        },
    };
}

/** Whether a node of a connection shows Open in Database Hub. */
export function databaseHubEligibility(
    connection: DatabaseHubConnection & { id?: string },
    database: string | undefined,
): DatabaseHubEligibility {
    const facts = connection.id
        ? serverFactsSource?.({ ...connection, id: connection.id })
        : undefined;
    return classifyDatabaseHubTarget(connection, database || undefined, facts).eligibility;
}

/** The Object Explorer context value key that menus match, as `databaseHub=(yes|maybe)`. */
export const databaseHubContextKey = "databaseHub";

/**
 * Tags a server or database node of the classic Object Explorer with its eligibility. Runs each
 * time the tree draws the node, so the tag follows the latest server facts.
 *
 * @returns whether the tag changed.
 */
export function applyDatabaseHubContext(node: TreeNodeInfo): boolean {
    const profile = node.connectionProfile;
    if (!profile?.server) {
        return false;
    }
    let database: string | undefined;
    if (
        node.nodeType === Constants.serverLabel ||
        node.nodeType === Constants.disconnectedServerNodeType
    ) {
        database = profile.database;
    } else if (node.nodeType === Constants.databaseString) {
        database = node.metadata?.name ?? String(node.label ?? "");
    } else {
        return false;
    }
    const eligibility = databaseHubEligibility(profile, database);
    const context = node.context as TreeNodeContextValue & { [databaseHubContextKey]?: string };
    if (context[databaseHubContextKey] === eligibility) {
        return false;
    }
    context[databaseHubContextKey] = eligibility;
    node.context = context;
    return true;
}
