/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FluentProvider } from "@fluentui/react-components";
import { ObjectManagementStateProvider } from "./objectManagementStateProvider";
import {
    DropDatabaseViewModel,
    ObjectManagementDialogType,
} from "../../../sharedInterfaces/objectManagement";
import { DropDatabaseDialogPage } from "./dropDatabaseDialogPage";
import { VscodeWebviewProvider2 } from "../../common/vscodeWebviewProvider2";
import { useObjectManagementSelector } from "./objectManagementSelector";
import "../../index.css";
import { createRoot } from "react-dom/client";

const DropDatabaseDialogRoot = () => {
    const model = useObjectManagementSelector((state) =>
        state.viewModel.dialogType === ObjectManagementDialogType.DropDatabase
            ? (state.viewModel.model as DropDatabaseViewModel | undefined)
            : undefined,
    );
    const isLoading = useObjectManagementSelector((state) => state.isLoading ?? false);
    const dialogTitle = useObjectManagementSelector((state) => state.dialogTitle);
    const errorMessage = useObjectManagementSelector((state) => state.errorMessage);

    return (
        <DropDatabaseDialogPage
            model={model}
            isLoading={isLoading}
            dialogTitle={dialogTitle}
            initializationError={errorMessage}
        />
    );
};

const App = () => {
    return (
        <VscodeWebviewProvider2>
            <ObjectManagementStateProvider>
                <FluentProvider>
                    <DropDatabaseDialogRoot />
                </FluentProvider>
            </ObjectManagementStateProvider>
        </VscodeWebviewProvider2>
    );
};

createRoot(document.getElementById("root")!).render(<App />);
