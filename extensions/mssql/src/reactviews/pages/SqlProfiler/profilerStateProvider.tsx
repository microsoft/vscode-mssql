/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as profiler from "../../../sharedInterfaces/profiler";

import { ReactNode, createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";

export interface ProfilerContextProps extends profiler.ProfilerProvider {}

const ProfilerContext = createContext<ProfilerContextProps | undefined>(undefined);

interface ProfilerProviderProps {
    children: ReactNode;
}

const ProfilerStateProvider: React.FC<ProfilerProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<profiler.ProfilerState, profiler.ProfilerReducers>();

    const commands = useMemo<ProfilerContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
            initializeProfiler: function (events: profiler.ProfilerEvent[]): void {
                extensionRpc.action("initializeProfiler", { events });
            },
            selectEvent: function (event: profiler.ProfilerEvent): void {
                extensionRpc.action("selectEvent", { event });
            },
            closeDetailsPanel: function (): void {
                extensionRpc.action("closeDetailsPanel", {});
            },
            toggleMaximize: function (): void {
                extensionRpc.action("toggleMaximize", {});
            },
            switchTab: function (tab: "text" | "details"): void {
                extensionRpc.action("switchTab", { tab });
            },
            openInEditor: function (textData: string, language?: string): void {
                extensionRpc.action("openInEditor", { textData, language });
            },
            copyTextData: function (textData: string): void {
                extensionRpc.action("copyTextData", { textData });
            },
            addEvents: function (events: profiler.ProfilerEvent[]): void {
                extensionRpc.action("addEvents", { events });
            },
        }),
        [extensionRpc],
    );

    return <ProfilerContext.Provider value={commands}>{children}</ProfilerContext.Provider>;
};

export { ProfilerContext, ProfilerStateProvider };
