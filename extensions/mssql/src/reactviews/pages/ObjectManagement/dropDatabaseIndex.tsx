/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom";
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

const DropDatabaseDialogRoot = () => {
    const model = useObjectManagementSelector((state) =>
        state.viewModel.dialogType === ObjectManagementDialogType.DropDatabase
            ? (state.viewModel.model as DropDatabaseViewModel | undefined)
            : undefined,
    );
    const isLoading = useObjectManagementSelector((state) => state.isLoading ?? false);
    const dialogTitle = useObjectManagementSelector((state) => state.dialogTitle);

    return <DropDatabaseDialogPage model={model} isLoading={isLoading} dialogTitle={dialogTitle} />;
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

ReactDOM.render(<App />, document.getElementById("root"));
