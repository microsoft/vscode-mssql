/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IConnectionInfo } from "vscode-mssql";

/**
 * Host seams for the docker orchestration layer (DOCK-0).
 *
 * The docker/deployment core is connection-agnostic: it speaks container
 * names, ports and log streams. The ONLY things it ever needed from a host
 * were (a) spinner/status text on the owning tree node, (b) an error toast,
 * and (c) a "container vanished — offer cleanup" interaction. Those used to
 * leak classic OE types (ConnectionNode/ObjectExplorerService) into
 * dockerUtils/sqlServerContainer; both Object Explorers now inject an
 * adapter instead. Behavior behind the v1 adapter is byte-identical.
 */

export interface ContainerHostAdapter {
    /** Saved engine; absent for profiles using the legacy Docker flow. */
    readonly containerEngine?: IConnectionInfo["containerEngine"];
    /** Progress/status text on the owning tree node ("Starting Docker…"). */
    setStatus(text: string): Promise<void> | void;
    /** Surface a user-facing error message. */
    showError(message: string): void;
    /**
     * The container no longer exists behind this node/profile: surface it
     * and offer cleanup (v1: modal + tree-node removal).
     */
    onContainerMissing(): Promise<void>;
}

/** Headless host (wizard steps, tests): status has nowhere to render. */
export const NULL_CONTAINER_HOST: ContainerHostAdapter = {
    setStatus: () => undefined,
    showError: () => undefined,
    onContainerMissing: async () => undefined,
};
