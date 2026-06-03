/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode, useContext, useMemo } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";
import {
    CloudDeployHubReducers,
    CloudDeployHubState,
    HubPage,
} from "../../../sharedInterfaces/cloudDeployHub";

/**
 * Commands the React app can dispatch back to the hub controller. Each
 * thin-wraps `extensionRpc.action(...)` so view components stay free of
 * RPC envelope details.
 */
export interface CloudDeployHubContextProps {
    extensionRpc: WebviewRpc<CloudDeployHubReducers>;
    navigate: (page: HubPage, opts?: { envId?: string; runId?: string }) => void;
    refresh: () => void;
    revealArtifact: (runId: string) => void;
    deleteRun: (runId: string) => void;
    compareRuns: (runIdA: string, runIdB: string) => void;
    setDefaultEnvironment: (envId: string | undefined) => void;
}

const CloudDeployHubContext = createContext<CloudDeployHubContextProps | undefined>(undefined);

interface ProviderProps {
    children: ReactNode;
}

export const CloudDeployHubStateProvider: React.FC<ProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<CloudDeployHubState, CloudDeployHubReducers>();

    const value = useMemo<CloudDeployHubContextProps>(
        () => ({
            extensionRpc,
            navigate: (page, opts) => {
                void extensionRpc.action("navigate", {
                    page,
                    envId: opts?.envId,
                    runId: opts?.runId,
                });
            },
            refresh: () => {
                void extensionRpc.action("refresh", {});
            },
            revealArtifact: (runId) => {
                void extensionRpc.action("revealArtifact", { runId });
            },
            deleteRun: (runId) => {
                void extensionRpc.action("deleteRun", { runId });
            },
            compareRuns: (runIdA, runIdB) => {
                void extensionRpc.action("compareRuns", { runIdA, runIdB });
            },
            setDefaultEnvironment: (envId) => {
                void extensionRpc.action("setDefaultEnvironment", { envId });
            },
        }),
        [extensionRpc],
    );

    return (
        <CloudDeployHubContext.Provider value={value}>{children}</CloudDeployHubContext.Provider>
    );
};

export function useCloudDeployHubContext(): CloudDeployHubContextProps {
    const ctx = useContext(CloudDeployHubContext);
    if (!ctx) {
        throw new Error("useCloudDeployHubContext must be used inside CloudDeployHubStateProvider");
    }
    return ctx;
}
