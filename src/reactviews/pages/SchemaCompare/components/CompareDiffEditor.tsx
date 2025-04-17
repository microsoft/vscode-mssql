/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { resolveVscodeThemeType } from "../../../common/utils";
import { Divider, makeStyles, tokens } from "@fluentui/react-components";
import { locConstants as loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    dividerContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyItems: "center",
        minHeight: "96px",
        backgroundColor: tokens.colorNeutralBackground1,
    },

    dividerFont: {
        fontSize: "16px",
        fontWeight: "bold",
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

    const original = diff?.sourceScript ? formatScript(diff?.sourceScript) : "";
    const modified = diff?.targetScript ? formatScript(diff?.targetScript) : "";

    return (
        <>
            <div className={classes.dividerContainer}>
                <Divider className={classes.dividerFont} alignContent="start">
                    {loc.schemaCompare.compareDetails}
                </Divider>
            </div>
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
        </>
    );
};

export default CompareDiffEditor;
