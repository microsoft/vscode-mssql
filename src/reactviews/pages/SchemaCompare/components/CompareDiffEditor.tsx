/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { resolveVscodeThemeType } from "../../../common/utils";
import { makeStyles } from "@fluentui/react-components";

const useStyles = makeStyles({
    editorContainer: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
});

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
    const classes = useStyles();
    const context = useContext(schemaCompareContext);
    const compareResult = context.state.schemaCompareResult;
    const diff = compareResult?.differences[selectedDiffId];
    const editorRef = useRef<any>(null);

    const original = formatScript(diff?.sourceScript);
    const modified = formatScript(diff?.targetScript);

    // Handle editor mount to store the reference
    const handleEditorDidMount = (editor: any) => {
        editorRef.current = editor;
    };

    // Update the editor layout when the container size changes
    useEffect(() => {
        const handleResize = () => {
            if (editorRef.current) {
                editorRef.current.layout();
            }
        };

        window.addEventListener("resize", handleResize);

        // Clean up event listener on component unmount
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    return (
        <div className={classes.editorContainer}>
            <DiffEditor
                height="100%"
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
                onMount={handleEditorDidMount}
            />
        </div>
    );
};

export default CompareDiffEditor;
