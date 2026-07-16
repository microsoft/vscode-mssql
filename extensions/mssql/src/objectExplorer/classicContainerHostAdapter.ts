/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Classic OE implementation of the docker-layer host seam (DOCK-0): spinner
 * text via loadingLabel/setLoadingUiForNode, error toasts, and the v1
 * container-vanished modal that offers node removal. This is byte-identical
 * to the behavior that used to live inside dockerUtils/sqlServerContainer —
 * the docker layer no longer imports classic OE types.
 */

import * as vscode from "vscode";
import { Common, LocalContainers } from "../constants/locConstants";
import { ContainerHostAdapter } from "../docker/containerHostAdapter";
import { ConnectionNode } from "./nodes/connectionNode";
import { ObjectExplorerService } from "./objectExplorerService";

export function classicContainerHostAdapter(
    node: ConnectionNode,
    objectExplorerService: ObjectExplorerService,
): ContainerHostAdapter {
    return {
        setStatus: async (text: string) => {
            node.loadingLabel = text;
            await objectExplorerService.setLoadingUiForNode(node);
        },
        showError: (message: string) => {
            void vscode.window.showErrorMessage(message);
        },
        onContainerMissing: async () => {
            const confirmation = await vscode.window.showInformationMessage(
                LocalContainers.containerDoesNotExistError,
                { modal: true },
                Common.remove,
            );
            if (confirmation === Common.remove) {
                await objectExplorerService.removeNode(node, false);
            }
        },
    };
}
