/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import {
    FlatFileImportReducers,
    FlatFileImportState,
    FlatFileImportProvider,
    FlatFileImportFormState,
    FlatFileStepType,
    ColumnChanges,
} from "../../../sharedInterfaces/flatFileImport";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { FormEvent } from "../../../sharedInterfaces/form";
import { WebviewRpc } from "../../common/rpc";

export interface FlatFileContextProps extends FlatFileImportProvider {
    extensionRpc: WebviewRpc<FlatFileImportReducers>;
}

export const FlatFileContext = createContext<FlatFileContextProps | undefined>(undefined);

export const FlatFileImportStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const { extensionRpc } = useVscodeWebview<FlatFileImportState, FlatFileImportReducers>();

    return (
        <FlatFileContext.Provider
            value={{
                extensionRpc,
                ...getCoreRPCs(extensionRpc),
                formAction: function (event: FormEvent<FlatFileImportFormState>): void {
                    extensionRpc.action("formAction", {
                        event: event,
                    });
                },
                getTablePreview: function (
                    filePath: string,
                    tableName: string,
                    schemaName?: string,
                ): void {
                    extensionRpc.action("getTablePreview", {
                        filePath: filePath,
                        tableName: tableName,
                        schemaName: schemaName,
                    });
                },
                setColumnChanges: function (columnChanges: ColumnChanges[]): void {
                    extensionRpc.action("setColumnChanges", {
                        columnChanges: columnChanges,
                    });
                },
                importData: function (): void {
                    extensionRpc.action("importData", {});
                },
                openVSCodeFileBrowser: function (): void {
                    extensionRpc.action("openVSCodeFileBrowser", {});
                },
                resetState: function (resetType: FlatFileStepType): void {
                    extensionRpc.action("resetState", {
                        resetType: resetType,
                    });
                },
                setStep: function (step: FlatFileStepType): void {
                    extensionRpc.action("setStep", {
                        step: step,
                    });
                },
                dispose: function (): void {
                    extensionRpc.action("dispose", {});
                },
            }}>
            {children}
        </FlatFileContext.Provider>
    );
};
