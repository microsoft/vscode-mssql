/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text, Toolbar } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { useContext, useEffect, useRef, useState } from "react";
import { locConstants } from "../../common/locConstants";
import Editor from "@monaco-editor/react";
import { resolveVscodeThemeType } from "../../common/utils";
import eventBus from "./schemaDesignerEvents";
import { Panel, ImperativePanelHandle } from "react-resizable-panels";

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

const DEFAULTPANEL_SIZE = 40;
const MINIMUMPANEL_SIZE = 10;
const MAXIMUMPANEL_SIZE = 100;

export const SchemaDesignerDefinitionsPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const [code, setCode] = useState<string>("");
    const panelRef = useRef<ImperativePanelHandle>(null);
    const [currentPanelSize, setCurrentPanelSize] = useState<number>(0);
    const [expandCollapseButtonLabel, setExpandCollapseButtonLabel] = useState<string>(
        locConstants.tableDesigner.maximizePanelSize,
    );
    const [expandCollapseButtonIcon, setExpandCollapseButtonIcon] = useState<JSX.Element>(
        <FluentIcons.ChevronUp12Filled />,
    );

    useEffect(() => {
        eventBus.on("getScript", () => {
            setTimeout(async () => {
                const script = await context.getDefinition();
                setCode(script);
            }, 0);
        });
        eventBus.on("openCodeDrawer", () => {
            setTimeout(async () => {
                const script = await context.getDefinition();
                setCode(script);
            }, 0);
            if (!panelRef.current) {
                return;
            }
            if (panelRef.current.isCollapsed()) {
                panelRef.current.expand(25);
            } else {
                panelRef.current.collapse();
            }
        });
    }, []);

    useEffect(() => {}, [currentPanelSize]);

    return (
        <Panel
            collapsible
            minSize={MINIMUMPANEL_SIZE}
            ref={panelRef}
            onResize={(size) => {
                setCurrentPanelSize(size);

                if (size === MAXIMUMPANEL_SIZE) {
                    setExpandCollapseButtonLabel(locConstants.tableDesigner.maximizePanelSize);
                    setExpandCollapseButtonIcon(<FluentIcons.ChevronDown12Filled />);
                } else {
                    setExpandCollapseButtonLabel(locConstants.tableDesigner.maximizePanelSize);
                    setExpandCollapseButtonIcon(<FluentIcons.ChevronUp12Filled />);
                }
            }}>
            <div className={classes.header}>
                <Text weight="medium" style={{ marginLeft: "10px" }}>
                    {locConstants.schemaDesigner.definition}
                </Text>
                <Toolbar style={{ gap: "3px" }}>
                    <Button
                        size="small"
                        appearance="subtle"
                        title={locConstants.schemaDesigner.openInEditor}
                        icon={<FluentIcons.Open12Regular />}
                        onClick={() => context.openInEditor(code)}>
                        {locConstants.schemaDesigner.openInEditor}
                    </Button>
                    <Button
                        size="small"
                        appearance="subtle"
                        title={locConstants.schemaDesigner.copy}
                        icon={<FluentIcons.Copy16Regular />}
                        onClick={() => context.copyToClipboard(code)}
                    />
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => {
                            if (panelRef.current?.getSize() === MAXIMUMPANEL_SIZE) {
                                panelRef.current?.resize(DEFAULTPANEL_SIZE);
                            } else {
                                panelRef.current?.resize(MAXIMUMPANEL_SIZE);
                            }
                        }}
                        title={expandCollapseButtonLabel}
                        icon={expandCollapseButtonIcon}
                    />
                    <Button
                        size="small"
                        appearance="subtle"
                        title={locConstants.schemaDesigner.close}
                        icon={<FluentIcons.Dismiss12Regular />}
                        onClick={() => {
                            if (panelRef.current) {
                                panelRef.current.collapse();
                            }
                        }}
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
        </Panel>
    );
};
