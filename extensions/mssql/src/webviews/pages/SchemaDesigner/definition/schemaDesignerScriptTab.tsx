/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { ScriptTabProps } from "../../../common/definitionPanel";
import { useContext, useMemo } from "react";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useSchemaDesignerDefinitionPanelContext } from "./schemaDesignerDefinitionPanelContext";
import {
    getSchemaDesignerDefinitionFormatLabel,
    getSchemaDesignerDefinitionLanguage,
    schemaDesignerDefinitionFormats,
    SchemaDesignerDefinitionFormat,
} from "./schemaDesignerDefinitionFormats";
import { SegmentedControl } from "../../../common/segmentedControl";
import { locConstants } from "../../../common/locConstants";
import { getSchemaDesignerScriptValue } from "./schemaDesignerOrmDefinitionGenerator";

const useStyles = makeStyles({
    formatSelectorScroller: {
        overflowX: "auto",
        maxWidth: "100%",
        paddingBottom: "2px",
    },
});

type SchemaDesignerScriptTabOptions = {
    code: string;
    themeKind: ColorThemeKind;
    language: string;
    headerActions?: React.ReactNode;
    openInEditor: (script: string) => void;
    copyToClipboard: (script: string) => void;
};

export const getSchemaDesignerScriptTab = ({
    code,
    themeKind,
    language,
    headerActions,
    openInEditor,
    copyToClipboard,
}: SchemaDesignerScriptTabOptions): ScriptTabProps => ({
    value: code,
    language,
    themeKind,
    headerActions,
    openInEditor,
    copyToClipboard,
});

export const useSchemaDesignerScriptTab = (): ScriptTabProps => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const { currentTsqlDefinition, selectedDefinitionFormat, setSelectedDefinitionFormat } =
        useSchemaDesignerDefinitionPanelContext();
    const { copyToClipboard, extractSchema, openInEditor, schemaRevision } = context;
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const schemaDesignerLoc = locConstants.schemaDesigner;
    const schema = useMemo(() => extractSchema(), [extractSchema, schemaRevision]);

    return useMemo(() => {
        const language = getSchemaDesignerDefinitionLanguage(selectedDefinitionFormat);
        const value = getSchemaDesignerScriptValue(
            selectedDefinitionFormat,
            currentTsqlDefinition,
            schema,
        );

        return getSchemaDesignerScriptTab({
            code: value,
            language,
            themeKind: themeKind as ColorThemeKind,
            headerActions: (
                <div className={classes.formatSelectorScroller}>
                    <SegmentedControl<SchemaDesignerDefinitionFormat>
                        value={selectedDefinitionFormat}
                        onValueChange={setSelectedDefinitionFormat}
                        ariaLabel={schemaDesignerLoc.definitionFormatAriaLabel}
                        options={schemaDesignerDefinitionFormats.map((format) => ({
                            value: format,
                            label: getSchemaDesignerDefinitionFormatLabel(
                                format,
                                schemaDesignerLoc,
                            ),
                        }))}
                    />
                </div>
            ),
            openInEditor: (script) =>
                openInEditor({
                    text: script,
                    language,
                }),
            copyToClipboard,
        });
    }, [
        classes.formatSelectorScroller,
        copyToClipboard,
        currentTsqlDefinition,
        openInEditor,
        schema,
        schemaDesignerLoc,
        selectedDefinitionFormat,
        setSelectedDefinitionFormat,
        themeKind,
    ]);
};
