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

export interface ContainerConnectAdapter {
    /** Persist the profile and open it in the owning Object Explorer (throws on failure). */
    saveAndConnect(profile: IConnectionProfile): Promise<void>;
}

/** Classic OE adapter — byte-identical to the pre-seam behavior. */
export function classicContainerConnectAdapter(
    mainController: MainController,
): ContainerConnectAdapter {
    return {
        saveAndConnect: async (connection: IConnectionProfile) => {
            const profile =
                await mainController.connectionManager.connectionUI.saveProfile(connection);
            await mainController.createObjectExplorerSession(profile);
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
        saveAndConnect: async (connection: IConnectionProfile) => {
            const profile =
                await mainController.connectionManager.connectionUI.saveProfile(connection);
            const connected = await vscode.commands.executeCommand<boolean>(
                "mssql.objectExplorerV2.connectProfileById",
                stableProfileId(profile as unknown as Parameters<typeof stableProfileId>[0]),
            );
            if (connected !== true) {
                throw new Error("Object Explorer v2 could not connect to the new container.");
            }
            void vscode.commands.executeCommand("mssql.objectExplorerV2.focus");
        },
    };
}
