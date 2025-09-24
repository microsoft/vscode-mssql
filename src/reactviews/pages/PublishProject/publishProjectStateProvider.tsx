/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";
import { WebviewRpc } from "../../common/rpc";
import {
    PublishDialogReducers,
    PublishDialogState,
    IPublishForm,
    PublishProjectProvider,
} from "../../../sharedInterfaces/publishDialog";
import { FormEvent } from "../../../sharedInterfaces/form";
import {
    LoggerLevel,
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../../../sharedInterfaces/webview";

export interface PublishProjectContextProps extends PublishProjectProvider {
    readonly state?: PublishDialogState;
    log(message: string, level?: LoggerLevel): void;
    sendActionEvent(event: WebviewTelemetryActionEvent): void;
    sendErrorEvent(event: WebviewTelemetryErrorEvent): void;
    /** Advanced escape hatch; prefer using typed provider methods */
    extensionRpc: WebviewRpc<PublishDialogReducers>;
}

// Optional payload for publishNow future expansion
export type PublishNowPayload = Parameters<PublishProjectProvider["publishNow"]>[0];

export const PublishProjectContext = createContext<PublishProjectContextProps | undefined>(
    undefined,
);

export const PublishProjectStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const { extensionRpc, getSnapshot } = useVscodeWebview2<
        PublishDialogState,
        PublishDialogReducers
    >();

    const value = useMemo<PublishProjectContextProps>(
        () => ({
            get state() {
                const inner = getSnapshot(); // inner PublishDialogState
                if (!inner || Object.keys(inner).length === 0) {
                    return undefined;
                }
                return inner;
            },
            ...getCoreRPCs2(extensionRpc),
            formAction: (event: FormEvent<IPublishForm>) =>
                extensionRpc.action("formAction", { event }),
            publishNow: (payload?: PublishNowPayload) =>
                extensionRpc.action("publishNow", payload ?? {}),
            generatePublishScript: () => extensionRpc.action("generatePublishScript"),
            selectPublishProfile: () => extensionRpc.action("selectPublishProfile"),
            savePublishProfile: (profileName: string) =>
                extensionRpc.action("savePublishProfile", { profileName }),
            setPublishValues: (values) => extensionRpc.action("setPublishValues", values),
            extensionRpc,
        }),
        [extensionRpc, getSnapshot],
    );

    return (
        <PublishProjectContext.Provider value={value}>{children}</PublishProjectContext.Provider>
    );
};
