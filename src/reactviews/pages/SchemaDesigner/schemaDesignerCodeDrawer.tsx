/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    InlineDrawer,
    Toolbar,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { useContext } from "react";
import { locConstants } from "../../common/locConstants";
import Editor from "@monaco-editor/react";
import { resolveVscodeThemeType } from "../../common/utils";

export const SchemaDesignerCodeDrawer = () => {
    const context = useContext(SchemaDesignerContext);
    return (
        <InlineDrawer
            separator
            open={context.isCodeDrawerOpen}
            position="bottom"
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Toolbar>
                            <Button
                                appearance="subtle"
                                aria-label={
                                    locConstants.schemaDesigner.openInEditor
                                }
                                icon={<FluentIcons.OpenRegular />}
                                onClick={() =>
                                    context.openInEditor(
                                        context.state?.script?.combinedScript,
                                    )
                                }
                            >
                                {locConstants.schemaDesigner.openInEditor}
                            </Button>
                            <Button
                                appearance="subtle"
                                aria-label="Copy"
                                icon={<FluentIcons.CopyRegular />}
                                onClick={() =>
                                    context.copyToClipboard(
                                        context.state?.script?.combinedScript,
                                    )
                                }
                            />
                            <Button
                                appearance="subtle"
                                aria-label="Close"
                                icon={<FluentIcons.Dismiss24Regular />}
                                onClick={() =>
                                    context.setIsCodeDrawerOpen(false)
                                }
                            />
                        </Toolbar>
                    }
                >
                    {locConstants.schemaDesigner.viewCode}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <Editor
                    height={"100%"}
                    width={"100%"}
                    language="sql"
                    theme={resolveVscodeThemeType(context?.themeKind)}
                    value={context.state?.script?.combinedScript ?? ""}
                    options={{
                        readOnly: true,
                    }}
                ></Editor>
            </DrawerBody>
        </InlineDrawer>
    );
};
