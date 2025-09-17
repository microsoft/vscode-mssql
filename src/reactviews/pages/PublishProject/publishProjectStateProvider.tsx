/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";
import {
    PublishDialogWebviewState,
    PublishDialogReducers,
} from "../../../sharedInterfaces/publishDialog";

interface PublishProjectContextValue {
    state?: PublishDialogWebviewState;
    formAction: (event: PublishFormActionEvent) => void;
    publishNow: (payload?: PublishNowPayload) => void;
    generatePublishScript: () => void;
    selectPublishProfile: () => void;
    savePublishProfile: (profileName: string) => void;
    setPublishValues: (
        values: Partial<PublishDialogWebviewState["formState"]> & { projectFilePath?: string },
    ) => void;
    extensionRpc?: WebviewRpc<PublishDialogReducers>;
}

// Event payload coming from shared FormField components
export interface PublishFormActionEvent {
    propertyName: keyof PublishDialogWebviewState["formState"];
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

const PublishProjectContext = createContext<PublishProjectContextValue | undefined>(undefined);

export const PublishProjectStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const webviewContext = useVscodeWebview<PublishDialogWebviewState, PublishDialogReducers>();
    const state = webviewContext?.state;

    const formAction = (event: PublishFormActionEvent) =>
        webviewContext?.extensionRpc.action("formAction", { event });

    const publishNow = (payload?: PublishNowPayload) =>
        webviewContext?.extensionRpc.action("publishNow", payload);

    const generatePublishScript = () =>
        webviewContext?.extensionRpc.action("generatePublishScript");

    const selectPublishProfile = () => webviewContext?.extensionRpc.action("selectPublishProfile");

    const savePublishProfile = (profileName: string) =>
        webviewContext?.extensionRpc.action("savePublishProfile", { profileName });

    const setPublishValues = (
        values: Partial<PublishDialogWebviewState["formState"]> & { projectFilePath?: string },
    ) => webviewContext?.extensionRpc.action("setPublishValues", values);

    return (
        <PublishProjectContext.Provider
            value={{
                state,
                formAction,
                publishNow,
                generatePublishScript,
                selectPublishProfile,
                savePublishProfile,
                setPublishValues,
                extensionRpc: webviewContext?.extensionRpc,
            }}>
            {children}
        </PublishProjectContext.Provider>
    );
};

export { PublishProjectContext };
