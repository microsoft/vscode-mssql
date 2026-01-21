/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom";
import { FluentProvider } from "@fluentui/react-components";
import { ObjectManagementStateProvider } from "./objectManagementStateProvider";
import {
    ObjectManagementDialogType,
    UserViewModel,
} from "../../../sharedInterfaces/objectManagement";
import { UserDialogPage } from "./userDialogPage";
import { VscodeWebviewProvider2 } from "../../common/vscodeWebviewProvider2";
import { useObjectManagementSelector } from "./objectManagementSelector";
import "../../index.css";

const UserDialogRoot = () => {
    const model = useObjectManagementSelector((state) =>
        state.viewModel.dialogType === ObjectManagementDialogType.User
            ? (state.viewModel.model as UserViewModel | undefined)
            : undefined,
    );
    const isLoading = useObjectManagementSelector((state) => state.isLoading ?? false);
    const dialogTitle = useObjectManagementSelector((state) => state.dialogTitle);

    return <UserDialogPage model={model} isLoading={isLoading} dialogTitle={dialogTitle} />;
};

const App = () => {
    return (
        <VscodeWebviewProvider2>
            <ObjectManagementStateProvider>
                <FluentProvider>
                    <UserDialogRoot />
                </FluentProvider>
            </ObjectManagementStateProvider>
        </VscodeWebviewProvider2>
    );
};

ReactDOM.render(<App />, document.getElementById("root"));
