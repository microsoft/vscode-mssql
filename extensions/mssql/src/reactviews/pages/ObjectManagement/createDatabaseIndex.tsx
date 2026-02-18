/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FluentProvider } from "@fluentui/react-components";
import { ObjectManagementStateProvider } from "./objectManagementStateProvider";
import {
    CreateDatabaseViewModel,
    ObjectManagementDialogType,
} from "../../../sharedInterfaces/objectManagement";
import { CreateDatabaseDialogPage } from "./createDatabaseDialogPage";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { useObjectManagementSelector } from "./objectManagementSelector";
import "../../index.css";
import { createRoot } from "react-dom/client";

const CreateDatabaseDialogRoot = () => {
    const model = useObjectManagementSelector((state) =>
        state.viewModel.dialogType === ObjectManagementDialogType.CreateDatabase
            ? (state.viewModel.model as CreateDatabaseViewModel | undefined)
            : undefined,
    );
    const isLoading = useObjectManagementSelector((state) => state.isLoading ?? false);
    const dialogTitle = useObjectManagementSelector((state) => state.dialogTitle);
    const errorMessage = useObjectManagementSelector((state) => state.errorMessage);

    return (
        <CreateDatabaseDialogPage
            model={model}
            isLoading={isLoading}
            dialogTitle={dialogTitle}
            initializationError={errorMessage}
        />
    );
};

const App = () => {
    return (
        <VscodeWebviewProvider>
            <ObjectManagementStateProvider>
                <FluentProvider>
                    <CreateDatabaseDialogRoot />
                </FluentProvider>
            </ObjectManagementStateProvider>
        </VscodeWebviewProvider>
    );
};

createRoot(document.getElementById("root")!).render(<App />);
