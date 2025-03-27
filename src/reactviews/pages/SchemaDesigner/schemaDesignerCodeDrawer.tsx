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
import { useContext, useEffect, useState } from "react";
import { locConstants } from "../../common/locConstants";
import Editor from "@monaco-editor/react";
import { resolveVscodeThemeType } from "../../common/utils";
import eventBus from "./schemaDesignerEvents";

export const SchemaDesignerCodeDrawer = () => {
    const context = useContext(SchemaDesignerContext);
    const [code, setCode] = useState<string>("");
    const [isCodeDrawerOpen, setIsCodeDrawerOpen] = useState<boolean>(false);

    useEffect(() => {
        eventBus.on("getScript", () => {
            setTimeout(async () => {
                const script = await context.getScript();
                setCode(script);
            }, 0);
        });
        eventBus.on("openCodeDrawer", () => {
            setIsCodeDrawerOpen(true);
            eventBus.emit("getScript");
        });
    }, []);

    return (
        <InlineDrawer separator open={isCodeDrawerOpen} position="bottom">
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
                                onClick={() => context.openInEditor(code)}
                            >
                                {locConstants.schemaDesigner.openInEditor}
                            </Button>
                            <Button
                                appearance="subtle"
                                aria-label="Copy"
                                icon={<FluentIcons.CopyRegular />}
                                onClick={() => context.copyToClipboard(code)}
                            />
                            <Button
                                appearance="subtle"
                                aria-label="Close"
                                icon={<FluentIcons.Dismiss24Regular />}
                                onClick={() => setIsCodeDrawerOpen(false)}
                            />
                        </Toolbar>
                    }
                >
                    {locConstants.schemaDesigner.viewCode}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <Editor
                    key={code}
                    height={"100%"}
                    width={"100%"}
                    language="sql"
                    theme={resolveVscodeThemeType(context?.themeKind)}
                    value={code}
                    options={{
                        readOnly: true,
                    }}
                ></Editor>
            </DrawerBody>
        </InlineDrawer>
    );
};
