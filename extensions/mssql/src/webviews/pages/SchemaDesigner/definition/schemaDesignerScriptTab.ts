/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { ScriptTabProps } from "../../../common/definitionPanel";
import { createElement, type ReactNode, useContext, useMemo } from "react";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useSchemaDesignerDefinitionPanelContext } from "./schemaDesignerDefinitionPanelContext";
import {
    getSchemaDesignerDefinitionOutput,
    SchemaDesignerDefinitionKind,
} from "../../../../sharedInterfaces/schemaDesignerDefinitionOutput";
import { SchemaDesignerDefinitionTypePicker } from "./schemaDesignerDefinitionTypePicker";

type SchemaDesignerScriptTabOptions = {
    code: string;
    language: string;
    themeKind: ColorThemeKind;
    headerActions?: ReactNode;
    addToWorkspace?: (script: string) => void;
    openInEditor: (script: string) => void;
    copyToClipboard: (script: string) => void;
};

export const getSchemaDesignerScriptTab = ({
    code,
    language,
    themeKind,
    headerActions,
    addToWorkspace,
    openInEditor,
    copyToClipboard,
}: SchemaDesignerScriptTabOptions): ScriptTabProps => ({
    value: code,
    language,
    themeKind,
    headerActions,
    addToWorkspace,
    openInEditor,
    copyToClipboard,
});

export const useSchemaDesignerScriptTab = (): ScriptTabProps => {
    const context = useContext(SchemaDesignerContext);
    const { addDefinitionToWorkspace, copyToClipboard, extractSchema, openInEditor } = context;
    const { code, selectedDefinitionKind } = useSchemaDesignerDefinitionPanelContext();
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();

    const definitionOutput = useMemo(() => {
        if (selectedDefinitionKind === SchemaDesignerDefinitionKind.Sql) {
            return {
                text: code,
                language: "sql",
            };
        }

        return getSchemaDesignerDefinitionOutput(extractSchema(), selectedDefinitionKind);
    }, [code, extractSchema, selectedDefinitionKind]);

    return useMemo(
        () =>
            getSchemaDesignerScriptTab({
                code: definitionOutput.text,
                language: definitionOutput.language,
                themeKind: themeKind as ColorThemeKind,
                headerActions: createElement(SchemaDesignerDefinitionTypePicker),
                addToWorkspace:
                    selectedDefinitionKind === SchemaDesignerDefinitionKind.Sql
                        ? undefined
                        : () => addDefinitionToWorkspace(selectedDefinitionKind),
                openInEditor: () => openInEditor(selectedDefinitionKind),
                copyToClipboard: () => copyToClipboard(selectedDefinitionKind),
            }),
        [
            addDefinitionToWorkspace,
            copyToClipboard,
            definitionOutput.language,
            definitionOutput.text,
            openInEditor,
            selectedDefinitionKind,
            themeKind,
        ],
    );
};
