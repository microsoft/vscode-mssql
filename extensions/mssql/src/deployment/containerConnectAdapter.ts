/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The wizard's terminal connect seam (DOCK-0/DOCK-1): after the container is
 * ready, ONE adapter persists the profile and opens it in the owning Object
 * Explorer. Classic OE saves through connectionUI and opens a classic OE
 * session; OE v2 saves through the same store and connects through the data
 * plane. The wizard itself never learns which tree launched it.
 */

import * as vscode from "vscode";
import MainController from "../controllers/mainController";
import { IConnectionProfile } from "../models/interfaces";
import { stableProfileId } from "../services/metadata/profileAuthAdapter";
import { ObjectExplorerV2 } from "../constants/locConstants";

export interface ContainerConnectAdapter {
    readonly usesDataPlane?: boolean;
    /**
     * Persist the profile, open it in the owning Object Explorer, and return a display-safe
     * connection string without a password. Throws when any part of the operation fails.
     * Writes the saved ID back to the input before connecting so retries reuse it.
     */
    saveAndConnect(profile: IConnectionProfile): Promise<string>;
}

async function getDisplayConnectionString(
    mainController: MainController,
    profile: IConnectionProfile,
): Promise<string> {
    return mainController.connectionManager.getConnectionString(
        mainController.connectionManager.createConnectionDetails(profile),
        false /* includePassword */,
        false /* includeApplicationName */,
    );
}

/** Classic OE adapter — uses the existing persistence and classic OE connection path. */
export function classicContainerConnectAdapter(
    mainController: MainController,
): ContainerConnectAdapter {
    return {
        saveAndConnect: async (connection: IConnectionProfile) => {
            const profile =
                await mainController.connectionManager.connectionUI.saveProfile(connection);
            connection.id = profile.id;
            const connectionString = await getDisplayConnectionString(mainController, profile);
            await mainController.createObjectExplorerSession(profile);
            return connectionString;
        },
    };
}

/**
 * OE v2 adapter (DOCK-1): the SAME profile persistence (settings.json +
 * credential store — the v2 profile adapter reads that store), then a
 * data-plane connect via the v2 tree's own command. No classic OE session
 * is ever created on this path.
 */
export function oeV2ContainerConnectAdapter(
    mainController: MainController,
): ContainerConnectAdapter {
    return {
        usesDataPlane: true,
        saveAndConnect: async (connection: IConnectionProfile) => {
            // Saving may clear the profile's password when retention is off.
            // Carry it only into this connection, without changing that policy.
            const password = connection.password;
            const profile =
                await mainController.connectionManager.connectionUI.saveProfile(connection);
            connection.id = profile.id;
            const connectionString = await getDisplayConnectionString(mainController, profile);
            const connected = await vscode.commands.executeCommand<boolean>(
                "mssql.objectExplorerV2.connectProfileById",
                stableProfileId(profile as unknown as Parameters<typeof stableProfileId>[0]),
                { password, freshContainer: true },
            );
            if (connected !== true) {
                throw new Error(ObjectExplorerV2.containerConnectionFailed);
            }
            void vscode.commands.executeCommand("mssql.objectExplorerV2.focus");
            return connectionString;
        },
    };
}
