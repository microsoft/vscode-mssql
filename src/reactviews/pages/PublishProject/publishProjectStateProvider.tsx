/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";
import {
    PublishDialogReducers,
    PublishDialogState,
    IPublishForm,
    PublishProjectProvider,
} from "../../../sharedInterfaces/publishDialog";
import { FormEvent } from "../../../sharedInterfaces/form";

export interface PublishProjectContextProps extends PublishProjectProvider {
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
    const { extensionRpc } = useVscodeWebview2<PublishDialogState, PublishDialogReducers>();

    const value = useMemo<PublishProjectContextProps>(
        () => ({
            formAction: (event: FormEvent<IPublishForm>) =>
                extensionRpc.action("formAction", { event }),
            publishNow: (payload?: PublishNowPayload) =>
                extensionRpc.action("publishNow", payload ?? {}),
            generatePublishScript: () => extensionRpc.action("generatePublishScript"),
            selectPublishProfile: () => extensionRpc.action("selectPublishProfile"),
            savePublishProfile: (publishProfileName: string) =>
                extensionRpc.action("savePublishProfile", { publishProfileName }),
            openConnectionDialog: () => extensionRpc.action("openConnectionDialog"),
            extensionRpc,
        }),
        [extensionRpc],
    );

    return (
        <PublishProjectContext.Provider value={value}>{children}</PublishProjectContext.Provider>
    );
};
