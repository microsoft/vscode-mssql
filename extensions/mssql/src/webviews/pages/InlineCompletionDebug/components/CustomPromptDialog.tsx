/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from "react";
import {
    Button,
    DrawerBody,
    DrawerHeader,
    DrawerHeaderTitle,
    OverlayDrawer,
    Text,
    Textarea,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { useInlineCompletionDebugSelector } from "../inlineCompletionDebugSelector";
import { useInlineCompletionDebugContext } from "../inlineCompletionDebugStateProvider";

const useStyles = makeStyles({
    drawerBody: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
    },
    drawerContent: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        height: "100%",
        minHeight: 0,
        rowGap: "12px",
    },
    subhead: {
        color: "var(--vscode-descriptionForeground)",
        flexShrink: 0,
    },
    infoBox: {
        backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent)",
        color: "var(--vscode-foreground)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        ...shorthands.border("1px", "solid", "var(--vscode-focusBorder)"),
        ...shorthands.borderRadius("6px"),
        ...shorthands.padding("10px", "12px"),
        flexShrink: 0,
    },
    editorContainer: {
        display: "flex",
        flex: 1,
        minHeight: 0,
    },
    editor: {
        display: "flex",
        flex: 1,
        minHeight: 0,
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
    },
    editorTextarea: {
        flex: 1,
        minHeight: "100%",
        height: "100%",
        overflowY: "auto",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
    },
    footer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        columnGap: "12px",
        flexShrink: 0,
    },
    footerMeta: {
        color: "var(--vscode-descriptionForeground)",
    },
    footerActions: {
        display: "flex",
        alignItems: "center",
        columnGap: "8px",
    },
});

export const CustomPromptDialog = () => {
    const classes = useStyles();
    const { closeCustomPromptDialog, saveCustomPrompt, resetCustomPrompt } =
        useInlineCompletionDebugContext();
    const customPrompt = useInlineCompletionDebugSelector((state) => state.customPrompt);
    const [draft, setDraft] = useState(customPrompt.savedValue ?? customPrompt.defaultValue);

    useEffect(() => {
        if (customPrompt.dialogOpen) {
            setDraft(customPrompt.savedValue ?? customPrompt.defaultValue);
        }
    }, [customPrompt.dialogOpen, customPrompt.savedValue, customPrompt.defaultValue]);

    useEffect(() => {
        if (!customPrompt.dialogOpen) {
            (document.activeElement as HTMLElement | null)?.blur?.();
        }
    }, [customPrompt.dialogOpen]);

    const lastSavedLabel = useMemo(() => {
        if (!customPrompt.lastSavedAt) {
            return "not saved yet";
        }
        return new Date(customPrompt.lastSavedAt).toLocaleTimeString([], {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }, [customPrompt.lastSavedAt]);

    return (
        <OverlayDrawer
            position="end"
            size="large"
            open={customPrompt.dialogOpen}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    closeCustomPromptDialog();
                }
            }}>
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            icon={<Dismiss24Regular />}
                            aria-label="Close"
                            onClick={closeCustomPromptDialog}
                        />
                    }>
                    Custom system prompt
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody className={classes.drawerBody}>
                <div className={classes.drawerContent}>
                    <Text className={classes.subhead}>
                        Stored in workspaceState memento | internal testing only | takes effect on
                        next completion
                    </Text>

                    <div className={classes.infoBox}>
                        Placeholders: {`{{inferredSystemQuery}}`}, {`{{intentMode}}`},{" "}
                        {`{{schemaContext}}`}, {`{{linePrefix}}`}, {`{{statementPrefix}}`}
                    </div>

                    <div className={classes.editorContainer}>
                        <Textarea
                            className={classes.editor}
                            size="large"
                            resize="vertical"
                            textarea={{
                                spellCheck: false,
                                className: classes.editorTextarea,
                            }}
                            value={draft}
                            onChange={(_, data) => setDraft(data.value)}
                        />
                    </div>

                    <div className={classes.footer}>
                        <Text className={classes.footerMeta}>
                            {draft.length} chars | last saved {lastSavedLabel}
                        </Text>
                        <div className={classes.footerActions}>
                            <Button appearance="subtle" onClick={resetCustomPrompt}>
                                Reset to default
                            </Button>
                            <Button appearance="secondary" onClick={closeCustomPromptDialog}>
                                Cancel
                            </Button>
                            <Button appearance="primary" onClick={() => saveCustomPrompt(draft)}>
                                Save &amp; use custom
                            </Button>
                        </div>
                    </div>
                </div>
            </DrawerBody>
        </OverlayDrawer>
    );
};
