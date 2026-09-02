/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiffBeforeMount, DiffEditor, DiffEditorProps } from "@monaco-editor/react";
import { useCallback } from "react";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { useVscodeMonacoTheme } from "../../../common/vscodeMonaco";
import { reverseSchemaCompareDiffColors } from "./compareDiffEditorUtils";

const SCHEMA_COMPARE_MONACO_THEME_NAME = "vscode-schema-compare-theme";

type SchemaCompareMonacoDiffEditorProps = Omit<DiffEditorProps, "theme"> & {
    themeKind: ColorThemeKind;
};

/**
 * Displays source on Monaco's original side and target on its modified side, while translating
 * Monaco's original-to-modified colors to Schema Compare's source-to-target deployment semantics.
 */
export function SchemaCompareMonacoDiffEditor({
    themeKind,
    beforeMount,
    ...props
}: SchemaCompareMonacoDiffEditorProps) {
    const monacoBeforeMount = useVscodeMonacoTheme(
        themeKind,
        SCHEMA_COMPARE_MONACO_THEME_NAME,
        reverseSchemaCompareDiffColors,
    );

    const combinedBeforeMount = useCallback<DiffBeforeMount>(
        (monaco) => {
            monacoBeforeMount(monaco);
            beforeMount?.(monaco);
        },
        [beforeMount, monacoBeforeMount],
    );

    return (
        <DiffEditor
            {...props}
            theme={SCHEMA_COMPARE_MONACO_THEME_NAME}
            beforeMount={combinedBeforeMount}
        />
    );
}
