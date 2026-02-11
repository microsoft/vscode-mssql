/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiffEditor } from "@monaco-editor/react";
import { Spinner, makeStyles } from "@fluentui/react-components";
import { resolveVscodeThemeType } from "../../../common/utils";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    container: {
        width: "100%",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
    },
    loadingContainer: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
});

interface SchemaDesignerChangesCodeDiffProps {
    originalScript: string;
    modifiedScript: string;
    themeKind: ColorThemeKind;
    isLoading: boolean;
}

export const SchemaDesignerChangesCodeDiff = ({
    originalScript,
    modifiedScript,
    themeKind,
    isLoading,
}: SchemaDesignerChangesCodeDiffProps) => {
    const classes = useStyles();

    if (isLoading) {
        return (
            <div className={classes.loadingContainer}>
                <Spinner />
            </div>
        );
    }

    return (
        <div className={classes.container}>
            <DiffEditor
                height="100%"
                width="100%"
                language="sql"
                original={originalScript}
                modified={modifiedScript}
                theme={resolveVscodeThemeType(themeKind)}
                options={{
                    readOnly: true,
                    renderSideBySide: true,
                    renderOverviewRuler: true,
                    minimap: {
                        enabled: false,
                    },
                }}
            />
        </div>
    );
};
