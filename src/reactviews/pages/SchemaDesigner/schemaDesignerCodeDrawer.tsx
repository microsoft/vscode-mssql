/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text, Toolbar } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { useContext, useEffect, useState } from "react";
import { locConstants } from "../../common/locConstants";
import Editor from "@monaco-editor/react";
import { resolveVscodeThemeType } from "../../common/utils";
import eventBus from "./schemaDesignerEvents";
import { ResizableBox } from "react-resizable";

const useStyles = makeStyles({
    resizeHandle: {
        position: "absolute",
        top: "0",
        right: "0",
        width: "100%",
        height: "10px",
        cursor: "ns-resize",
        zIndex: 1,
        boxShadow: "0px -1px 1px  var(--vscode-editorWidget-border)",
    },
    resizePaneContainer: {
        width: "100%",
        position: "relative",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
    },
});

export const SchemaDesignerCodeDrawer = () => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const [code, setCode] = useState<string>("");
    const [isCodeDrawerOpen, setIsCodeDrawerOpen] = useState<boolean>(false);
    const [drawerHeight, setDrawerHeight] = useState<number>(400);
    const [isMaximized, setIsMaximized] = useState<boolean>(false);

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
        <ResizableBox
            width={Infinity}
            height={isCodeDrawerOpen ? (isMaximized ? 9999999 : drawerHeight) : 0}
            maxConstraints={[Infinity, Infinity]}
            minConstraints={[Infinity, 10]}
            resizeHandles={["n"]}
            handle={<div className={classes.resizeHandle} />}
            className={classes.resizePaneContainer}
            onResizeStart={(_e, _div) => {
                setIsMaximized(false);
            }}
            onResizeStop={(_e, div) => {
                console.log("div", div);
                const parentContainerHeight = div.node!.parentElement!.parentElement!.offsetHeight!;

                const currentDivHeight = div.size.height;
                if (currentDivHeight >= parentContainerHeight - 50) {
                    console.log("maximized");
                    console.log("drawerHeight", drawerHeight);
                    setIsMaximized(true);
                    setDrawerHeight(parentContainerHeight);
                } else {
                    console.log("DrawerHeight", div.size.height);
                    setDrawerHeight(div.size.height);
                }
            }}>
            <div className={classes.header}>
                <Text size={400} weight="medium" style={{ marginLeft: "10px" }}>
                    {locConstants.schemaDesigner.viewCode}
                </Text>
                <Toolbar>
                    <Button
                        appearance="subtle"
                        aria-label={locConstants.schemaDesigner.openInEditor}
                        icon={<FluentIcons.OpenRegular />}
                        onClick={() => context.openInEditor(code)}>
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
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => {
                            if (isMaximized) {
                                setDrawerHeight(400);
                            }
                            setIsMaximized(!isMaximized);
                        }}
                        title={
                            isMaximized
                                ? locConstants.tableDesigner.restorePanelSize
                                : locConstants.tableDesigner.maximizePanelSize
                        }
                        icon={
                            isMaximized ? (
                                <FluentIcons.ChevronDownFilled />
                            ) : (
                                <FluentIcons.ChevronUpFilled />
                            )
                        }
                    />
                </Toolbar>
            </div>
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
            />
        </ResizableBox>
    );
};
