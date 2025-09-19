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
} from "../../../sharedInterfaces/publishDialog";

export interface PublishProjectContextValue {
    // Use inner state directly for form system generics
    state?: PublishDialogState; // snapshot accessor
    formAction: (event: PublishFormActionEvent) => void;
    publishNow: (payload?: PublishNowPayload) => void;
    generatePublishScript: () => void;
    selectPublishProfile: () => void;
    savePublishProfile: (profileName: string) => void;
    setPublishValues: (
        values: Partial<PublishDialogState["formState"]> & { projectFilePath?: string },
    ) => void;
    extensionRpc: WebviewRpc<PublishDialogReducers>;
}

// Event payload coming from shared FormField components
export interface PublishFormActionEvent {
    propertyName: keyof IPublishForm;
    value: string | boolean;
    isAction: boolean; // true when triggered by an action button on the field
    updateValidation?: boolean; // optional flag to force validation
}

// Optional payload for publishNow future expansion
export interface PublishNowPayload {
    projectFilePath?: string;
    databaseName?: string;
    connectionUri?: string;
    sqlCmdVariables?: { [key: string]: string };
    publishProfilePath?: string;
}

export const PublishProjectContext = createContext<PublishProjectContextValue | undefined>(
    undefined,
);

export const PublishProjectStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const { extensionRpc, getSnapshot } = useVscodeWebview2<
        PublishDialogState,
        PublishDialogReducers
    >();

    const value = useMemo<PublishProjectContextValue>(
        () => ({
            get state() {
                const inner = getSnapshot(); // inner PublishDialogState
                if (!inner || Object.keys(inner).length === 0) {
                    return undefined;
                }
                return inner;
            },
            formAction: (event: PublishFormActionEvent) =>
                extensionRpc.action("formAction", { event }),
            publishNow: (payload?: PublishNowPayload) =>
                extensionRpc.action("publishNow", payload ?? {}),
            generatePublishScript: () => extensionRpc.action("generatePublishScript"),
            selectPublishProfile: () => extensionRpc.action("selectPublishProfile"),
            savePublishProfile: (profileName: string) =>
                extensionRpc.action("savePublishProfile", { profileName }),
            setPublishValues: (
                values: Partial<PublishDialogState["formState"]> & { projectFilePath?: string },
            ) => extensionRpc.action("setPublishValues", values),
            extensionRpc,
        }),
        [extensionRpc, getSnapshot],
    );

    return (
        <PublishProjectContext.Provider value={value}>{children}</PublishProjectContext.Provider>
    );
};
