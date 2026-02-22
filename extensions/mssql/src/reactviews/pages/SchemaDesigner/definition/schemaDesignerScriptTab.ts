/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { ScriptTabProps } from "../../../common/definitionPanel";
import { useContext, useMemo } from "react";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useSchemaDesignerDefinitionPanelContext } from "./schemaDesignerDefinitionPanelContext";

type SchemaDesignerScriptTabOptions = {
    code: string;
    themeKind: ColorThemeKind;
    openInEditor: (script: string) => void;
    copyToClipboard: (script: string) => void;
};

export const getSchemaDesignerScriptTab = ({
    code,
    themeKind,
    openInEditor,
    copyToClipboard,
}: SchemaDesignerScriptTabOptions): ScriptTabProps => ({
    value: code,
    language: "sql",
    themeKind,
    openInEditor,
    copyToClipboard,
});

export const useSchemaDesignerScriptTab = (): ScriptTabProps => {
    const context = useContext(SchemaDesignerContext);
    const { code } = useSchemaDesignerDefinitionPanelContext();
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();

    return useMemo(
        () =>
            getSchemaDesignerScriptTab({
                code,
                themeKind: themeKind as ColorThemeKind,
                openInEditor: context.openInEditor,
                copyToClipboard: context.copyToClipboard,
            }),
        [code, context.copyToClipboard, context.openInEditor, themeKind],
    );
};
