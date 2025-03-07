/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { resolveVscodeThemeType } from "../../../common/utils";

const formatScript = (script: string): string => {
    if (!script) {
        return "";
    }

    return script;
};

interface Props {
    selectedDiffId: number;
    renderSideBySide?: boolean;
}

const CompareDiffEditor = ({ selectedDiffId, renderSideBySide }: Props) => {
    const context = useContext(schemaCompareContext);
    const compareResult = context.state.schemaCompareResult;
    const diff = compareResult?.differences[selectedDiffId];

    const original = formatScript(diff?.sourceScript);
    const modified = formatScript(diff?.targetScript);

    return (
        <div style={{ height: "60vh" }}>
            <DiffEditor
                height="60vh"
                language="sql"
                original={modified}
                modified={original}
                theme={resolveVscodeThemeType(context.themeKind)}
                options={{
                    renderSideBySide: renderSideBySide ?? true,
                    renderOverviewRuler: true,
                    OverviewRulerLane: 0,
                    readOnly: true,
                }}
            />
        </div>
    );
};

export default CompareDiffEditor;
