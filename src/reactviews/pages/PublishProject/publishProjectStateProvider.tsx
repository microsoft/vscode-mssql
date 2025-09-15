/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    PublishDialogWebviewState,
    PublishDialogReducers,
} from "../../../sharedInterfaces/publishDialog";

interface PublishProjectContextValue {
    state?: PublishDialogWebviewState;
    formAction: (event: any) => void;
    publishNow: (payload?: any) => void;
    generatePublishScript: () => void;
    openPublishAdvanced: () => void;
    cancelPublish: () => void;
    selectPublishProfile: () => void;
    savePublishProfile: (profileName: string) => void;
    setPublishValues: (
        values: Partial<PublishDialogWebviewState["formState"]> & { projectFilePath?: string },
    ) => void;
    extensionRpc?: any;
}

const PublishProjectContext = createContext<PublishProjectContextValue | undefined>(undefined);

export const PublishProjectStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const webviewContext = useVscodeWebview<PublishDialogWebviewState, PublishDialogReducers>();
    const state = webviewContext?.state;

    const formAction = (event: any) => webviewContext?.extensionRpc.action("formAction", { event });

    const publishNow = (payload?: any) =>
        webviewContext?.extensionRpc.action("publishNow", payload);

    const generatePublishScript = () =>
        webviewContext?.extensionRpc.action("generatePublishScript");

    const openPublishAdvanced = () => webviewContext?.extensionRpc.action("openPublishAdvanced");

    const cancelPublish = () => webviewContext?.extensionRpc.action("cancelPublish");

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
                openPublishAdvanced,
                cancelPublish,
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
