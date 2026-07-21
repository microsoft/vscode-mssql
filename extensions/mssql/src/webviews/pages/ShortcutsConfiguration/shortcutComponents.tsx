/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ClipboardEvent as ReactClipboardEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type RefObject,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarBody,
    Spinner,
    Text,
    Tooltip,
    tokens,
} from "@fluentui/react-components";
import { Checkmark12Regular, Keyboard16Regular, Open16Regular } from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import {
    ConfigurableKeyCommand,
    QuickQuerySlot,
} from "../../../sharedInterfaces/shortcutsConfiguration";
import { ShortcutItem } from "./shortcutDefinitions";
import {
    formatShortcut,
    HighlightedText,
    readModifiers,
    shortcutFromKeyboardEvent,
} from "./shortcutKeyboardUtils";

export type SaveState = "idle" | "saving" | "saved";

const controlHeight = "30px";
const monoFont = "var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace)";
type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
type MonacoRange = import("monaco-editor").IRange;
type Monaco = typeof import("monaco-editor");

interface CutEdit {
    range: MonacoRange;
    clipboardText: string;
}

function isPasteShortcut(event: ReactKeyboardEvent<HTMLElement>): boolean {
    return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "v";
}

function isCutShortcut(event: ReactKeyboardEvent<HTMLElement>): boolean {
    return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "x";
}

function insertTextIntoEditor(editor: MonacoEditor, text: string): void {
    if (!text) {
        return;
    }

    const selections = editor.getSelections();
    if (!selections?.length) {
        return;
    }

    editor.pushUndoStop();
    editor.executeEdits(
        "shortcutsConfigurationPaste",
        selections.map((range) => ({
            range,
            text,
            forceMoveMarkers: true,
        })),
    );
    editor.pushUndoStop();
}

function registerSelectedTextCompletionProvider(
    editor: MonacoEditor,
    monaco: Monaco,
    loc: typeof locConstants.shortcutsConfiguration,
): import("monaco-editor").IDisposable | undefined {
    const targetModel = editor.getModel();
    if (!targetModel) {
        return undefined;
    }

    return monaco.languages.registerCompletionItemProvider("sql", {
        triggerCharacters: ["{"],
        provideCompletionItems: (model, position) => {
            if (model !== targetModel) {
                return { suggestions: [] };
            }

            const lineContent = model.getLineContent(position.lineNumber);
            const linePrefix = lineContent.slice(0, position.column - 1);
            const partialArgument = /\{[A-Za-z_]*$/.exec(linePrefix);
            const hasAutoClosingBrace = partialArgument && lineContent[position.column - 1] === "}";
            const wordUntilPosition = model.getWordUntilPosition(position);
            const currentWord =
                model.getWordAtPosition(position) ||
                (wordUntilPosition.word ? wordUntilPosition : undefined);
            const range = new monaco.Range(
                position.lineNumber,
                partialArgument
                    ? partialArgument.index + 1
                    : (currentWord?.startColumn ?? position.column),
                position.lineNumber,
                hasAutoClosingBrace
                    ? position.column + 1
                    : (currentWord?.endColumn ?? position.column),
            );

            return {
                suggestions: [
                    {
                        label: "{arg}",
                        kind: monaco.languages.CompletionItemKind.Variable,
                        insertText: "{arg}",
                        detail: loc.selectedTextCompletionDetail,
                        documentation: loc.selectedTextArgumentHint,
                        range,
                    },
                ],
            };
        },
    });
}

function getCutEdits(editor: MonacoEditor): CutEdit[] {
    const model = editor.getModel();
    const selections = editor.getSelections();
    if (!model || !selections?.length) {
        return [];
    }

    return selections.flatMap((selection) => {
        if (!selection.isEmpty()) {
            return [
                {
                    range: selection,
                    clipboardText: model.getValueInRange(selection),
                },
            ];
        }

        const lineNumber = selection.startLineNumber;
        const lineCount = model.getLineCount();
        if (lineNumber < lineCount) {
            const range = {
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber + 1,
                endColumn: 1,
            };
            return [
                {
                    range,
                    clipboardText: model.getValueInRange(range),
                },
            ];
        }

        const lineMaxColumn = model.getLineMaxColumn(lineNumber);
        const clipboardText =
            lineCount > 1
                ? `${model.getLineContent(lineNumber)}${model.getEOL()}`
                : model.getValue();
        const range =
            lineNumber > 1
                ? {
                      startLineNumber: lineNumber - 1,
                      startColumn: model.getLineMaxColumn(lineNumber - 1),
                      endLineNumber: lineNumber,
                      endColumn: lineMaxColumn,
                  }
                : {
                      startLineNumber: lineNumber,
                      startColumn: 1,
                      endLineNumber: lineNumber,
                      endColumn: lineMaxColumn,
                  };

        return [
            {
                range,
                clipboardText,
            },
        ];
    });
}

function deleteCutEdits(editor: MonacoEditor, edits: CutEdit[]): void {
    if (edits.length === 0) {
        return;
    }

    editor.pushUndoStop();
    editor.executeEdits(
        "shortcutsConfigurationCut",
        edits.map((edit) => ({
            range: edit.range,
            text: "",
            forceMoveMarkers: true,
        })),
    );
    editor.pushUndoStop();
}

function useOutsidePointerClose(
    surfaceRef: RefObject<HTMLElement | null>,
    open: boolean,
    onClose: () => void,
): void {
    useEffect(() => {
        if (!open) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            const surface = surfaceRef.current;
            const target = event.target;
            if (!surface || !(target instanceof Node) || surface.contains(target)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            onClose();
        };

        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [onClose, open, surfaceRef]);
}

const useStyles = makeStyles({
    saveIndicator: {
        alignItems: "center",
        color: "var(--vscode-descriptionForeground)",
        display: "flex",
        fontSize: tokens.fontSizeBase100,
        gap: "6px",
    },
    saveIndicatorSaved: {
        color: "var(--vscode-testing-iconPassed, var(--vscode-charts-green))",
    },
    queryDialog: {
        maxWidth: "calc(100vw - 64px)",
        outlineStyle: "none",
        width: "900px",
        "@media (max-width: 640px)": {
            maxWidth: "calc(100vw - 24px)",
        },
    },
    queryDialogContent: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "100%",
    },
    field: {
        color: "var(--vscode-descriptionForeground)",
        display: "flex",
        flexDirection: "column",
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        gap: "5px",
        minWidth: 0,
    },
    monacoShell: {
        border: "1px solid var(--vscode-input-border, var(--vscode-editorGroup-border))",
        borderRadius: "6px",
        height: "420px",
        overflow: "hidden",
        ":focus-within": {
            borderBottomColor: "var(--vscode-focusBorder)",
            borderLeftColor: "var(--vscode-focusBorder)",
            borderRightColor: "var(--vscode-focusBorder)",
            borderTopColor: "var(--vscode-focusBorder)",
        },
    },
    shortcutInput: {
        cursor: "pointer",
        height: controlHeight,
        maxWidth: "260px",
        minWidth: "190px",
        width: "232px",
        "& input": {
            cursor: "pointer",
            fontFamily: monoFont,
            userSelect: "none",
        },
    },
    shortcutInputEmpty: {
        "& input": {
            color: "var(--vscode-disabledForeground)",
        },
    },
    shortcutInputIcon: {
        color: "var(--vscode-descriptionForeground)",
        display: "flex",
    },
    shortcutInputIconButton: {
        alignItems: "center",
        borderRadius: "2px",
        cursor: "pointer",
        display: "inline-flex",
        justifyContent: "center",
        padding: "2px",
        ":hover": {
            color: "var(--vscode-foreground)",
        },
    },
    vscodeManagedShortcutAction: {
        alignItems: "center",
        backgroundColor: "var(--vscode-input-background)",
        border: "1px solid var(--vscode-input-border, var(--vscode-editorWidget-border))",
        borderRadius: "4px",
        color: "var(--vscode-descriptionForeground)",
        cursor: "pointer",
        display: "inline-flex",
        flex: "0 0 auto",
        font: "inherit",
        fontSize: tokens.fontSizeBase200,
        gap: "6px",
        justifyContent: "flex-end",
        minHeight: controlHeight,
        overflow: "hidden",
        padding: "5px 10px",
        width: "220px",
        whiteSpace: "nowrap",
        ":hover": {
            backgroundColor: "var(--vscode-toolbar-hoverBackground)",
            borderBottomColor: "var(--vscode-focusBorder)",
            borderLeftColor: "var(--vscode-focusBorder)",
            borderRightColor: "var(--vscode-focusBorder)",
            borderTopColor: "var(--vscode-focusBorder)",
            color: "var(--vscode-foreground)",
        },
        ":focus-visible": {
            outlineColor: "var(--vscode-focusBorder)",
            outlineOffset: "2px",
            outlineStyle: "solid",
            outlineWidth: "1px",
        },
        ":hover .vscodeManagedShortcutActionText": {
            opacity: 1,
        },
        ":hover .vscodeManagedShortcutActionOpenIcon": {
            opacity: 1,
        },
        ":focus-visible .vscodeManagedShortcutActionText": {
            opacity: 1,
        },
        ":focus-visible .vscodeManagedShortcutActionOpenIcon": {
            opacity: 1,
        },
    },
    vscodeManagedShortcutActionText: {
        display: "inline-flex",
        flex: "1 1 auto",
        minWidth: 0,
        opacity: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    vscodeManagedShortcutActionIcon: {
        display: "inline-flex",
        flex: "0 0 auto",
        height: "16px",
        width: "16px",
    },
    vscodeManagedShortcutActionOpenIcon: {
        display: "inline-flex",
        flex: "0 0 auto",
        height: "14px",
        opacity: 0,
        width: "14px",
    },
    webviewShortcutRow: {
        alignItems: "center",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        display: "grid",
        gap: "20px",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        padding: "10px 0",
        ":last-child": {
            borderBottom: "none",
        },
        "@media (max-width: 640px)": {
            gridTemplateColumns: "1fr",
        },
    },
    rowLabel: {
        color: "var(--vscode-foreground)",
        display: "block",
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    rowDescription: {
        color: "var(--vscode-descriptionForeground)",
        display: "block",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
    },
    recorder: {
        maxWidth: "100%",
        outlineStyle: "none",
        width: "420px",
    },
    recorderSubtitle: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        marginTop: "4px",
    },
    recorderBody: {
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "20px 0 4px",
    },
    keyInput: {
        alignItems: "center",
        backgroundColor:
            "var(--vscode-settings-textInputBackground, var(--vscode-input-background))",
        border: "1px solid var(--vscode-settings-textInputBorder, var(--vscode-input-border, transparent))",
        borderRadius: "2px",
        boxSizing: "border-box",
        display: "flex",
        justifyContent: "center",
        minHeight: controlHeight,
        padding: "4px 10px",
        position: "relative",
        transitionProperty: "border-color",
        transitionDuration: "0.1s",
        transitionTimingFunction: "ease-in-out",
        width: "100%",
    },
    keyInputContent: {
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        minWidth: 0,
        paddingLeft: controlHeight,
        paddingRight: controlHeight,
        width: "100%",
    },
    keyInputRecording: {
        borderBottomColor: "var(--vscode-focusBorder)",
        borderLeftColor: "var(--vscode-focusBorder)",
        borderRightColor: "var(--vscode-focusBorder)",
        borderTopColor: "var(--vscode-focusBorder)",
    },
    keyCaret: {
        backgroundColor: "var(--vscode-editorCursor-foreground, var(--vscode-foreground))",
        display: "inline-block",
        height: "18px",
        width: "2px",
    },
    keyBadges: {
        alignItems: "center",
        display: "flex",
        flexWrap: "wrap",
        gap: "4px",
        justifyContent: "center",
    },
    keyBadge: {
        backgroundColor: "var(--vscode-keybindingLabel-background, var(--vscode-badge-background))",
        border: "1px solid var(--vscode-keybindingLabel-border, transparent)",
        borderBottomColor:
            "var(--vscode-keybindingLabel-bottomBorder, var(--vscode-keybindingLabel-border, transparent))",
        borderRadius: "3px",
        boxShadow: "inset 0 -1px 0 var(--vscode-keybindingLabel-bottomBorder, transparent)",
        color: "var(--vscode-keybindingLabel-foreground, var(--vscode-foreground))",
        fontFamily: "inherit",
        fontSize: tokens.fontSizeBase100,
        lineHeight: "1",
        padding: "3px 6px",
    },
    warning: {
        width: "100%",
    },
});

export const SaveIndicator = ({ state }: { state: SaveState }) => {
    const classes = useStyles();

    if (state === "idle") {
        return null;
    }

    return (
        <div
            className={mergeClasses(
                classes.saveIndicator,
                state === "saved" && classes.saveIndicatorSaved,
            )}>
            {state === "saving" ? (
                <>
                    <Spinner size="tiny" />
                    <span>{locConstants.shortcutsConfiguration.saving}</span>
                </>
            ) : (
                <>
                    <Checkmark12Regular />
                    <span>{locConstants.shortcutsConfiguration.saved}</span>
                </>
            )}
        </div>
    );
};

export const ShortcutRecorder = ({
    onSave,
    onClose,
    findConflict,
}: {
    onSave: (value: string) => void;
    onClose: () => void;
    findConflict?: (value: string) => string | undefined;
}) => {
    const classes = useStyles();
    const [preview, setPreview] = useState("");
    const [liveModifiers, setLiveModifiers] = useState<string[]>([]);
    const surfaceRef = useRef<HTMLDivElement | null>(null);

    useOutsidePointerClose(surfaceRef, true, onClose);

    useEffect(() => {
        surfaceRef.current?.focus();
    }, []);

    const onKeyDownCapture = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === "Enter") {
                if (!preview.trim() || !findConflict?.(preview)) {
                    onSave(preview);
                    onClose();
                }
                return;
            }

            if (event.key === "Escape") {
                if (!preview.trim() && liveModifiers.length === 0) {
                    onClose();
                    return;
                }

                setPreview("");
                setLiveModifiers([]);
                return;
            }

            setLiveModifiers(readModifiers(event.nativeEvent));

            const shortcut = shortcutFromKeyboardEvent(event.nativeEvent);
            if (shortcut) {
                setPreview(shortcut);
                setLiveModifiers([]);
            }
        },
        [findConflict, liveModifiers.length, onClose, onSave, preview],
    );

    const onKeyUpCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        setLiveModifiers(readModifiers(event.nativeEvent));
    }, []);

    const hasPreview = preview.trim().length > 0;
    const displayValue = preview || liveModifiers.join("+");
    const tokens = formatShortcut(displayValue)
        .split("+")
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
    const conflictTarget = hasPreview ? findConflict?.(preview) : undefined;

    return (
        <Dialog
            open
            modalType="non-modal"
            onOpenChange={(_event, data) => {
                if (!data.open) {
                    onClose();
                }
            }}>
            <DialogSurface
                ref={surfaceRef}
                className={classes.recorder}
                aria-label={locConstants.shortcutsConfiguration.recordShortcut}
                tabIndex={-1}
                onKeyDownCapture={onKeyDownCapture}
                onKeyUpCapture={onKeyUpCapture}>
                <DialogBody>
                    <DialogContent>
                        <Text size={200} className={classes.recorderSubtitle}>
                            {locConstants.shortcutsConfiguration.recordShortcutDescription}
                        </Text>
                        <div className={classes.recorderBody}>
                            <div
                                className={mergeClasses(
                                    classes.keyInput,
                                    classes.keyInputRecording,
                                )}>
                                <div className={classes.keyInputContent}>
                                    {tokens.length > 0 ? (
                                        <div className={classes.keyBadges}>
                                            {tokens.map((token, index) => (
                                                <kbd
                                                    key={`${token}-${index}`}
                                                    className={classes.keyBadge}>
                                                    {token}
                                                </kbd>
                                            ))}
                                        </div>
                                    ) : (
                                        <span
                                            className={classes.keyCaret}
                                            role="img"
                                            aria-label={
                                                locConstants.shortcutsConfiguration
                                                    .recordingShortcut
                                            }
                                        />
                                    )}
                                </div>
                            </div>
                            {conflictTarget && (
                                <MessageBar intent="warning" className={classes.warning}>
                                    <MessageBarBody>
                                        {locConstants.shortcutsConfiguration.shortcutConflict(
                                            conflictTarget,
                                        )}
                                    </MessageBarBody>
                                </MessageBar>
                            )}
                        </div>
                    </DialogContent>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export const ShortcutChip = ({
    value,
    onRecord,
    recordLabel,
}: {
    value: string;
    onRecord: () => void;
    recordLabel: string;
}) => {
    const classes = useStyles();
    const displayValue = formatShortcut(value) || locConstants.shortcutsConfiguration.noShortcut;

    const onKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            onRecord();
        },
        [onRecord],
    );
    const onIconMouseDown = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
        event.preventDefault();
    }, []);
    const onIconClick = useCallback(
        (event: ReactMouseEvent<HTMLSpanElement>) => {
            event.preventDefault();
            event.stopPropagation();
            onRecord();
        },
        [onRecord],
    );

    return (
        <Tooltip content={recordLabel} relationship="label">
            <Input
                aria-label={recordLabel}
                className={mergeClasses(
                    classes.shortcutInput,
                    !value && classes.shortcutInputEmpty,
                )}
                contentAfter={
                    <span
                        className={classes.shortcutInputIconButton}
                        onClick={onIconClick}
                        onMouseDown={onIconMouseDown}>
                        <Keyboard16Regular aria-hidden className={classes.shortcutInputIcon} />
                    </span>
                }
                readOnly
                title={displayValue}
                value={displayValue}
                onClick={onRecord}
                onKeyDown={onKeyDown}
            />
        </Tooltip>
    );
};

export const VscodeManagedShortcutAction = ({
    onOpen,
    label,
}: {
    onOpen: () => void;
    label: string;
}) => {
    const classes = useStyles();

    return (
        <button
            type="button"
            aria-label={label}
            className={classes.vscodeManagedShortcutAction}
            onClick={onOpen}>
            <span
                className={mergeClasses(
                    classes.vscodeManagedShortcutActionText,
                    "vscodeManagedShortcutActionText",
                )}>
                {locConstants.shortcutsConfiguration.viewConfigureKeybinding}
            </span>
            <Open16Regular
                aria-hidden
                className={mergeClasses(
                    classes.vscodeManagedShortcutActionOpenIcon,
                    "vscodeManagedShortcutActionOpenIcon",
                )}
            />
            <Keyboard16Regular aria-hidden className={classes.vscodeManagedShortcutActionIcon} />
        </button>
    );
};

export const QuickQueryEditorDialog = ({
    slot,
    slotName,
    open,
    onClose,
    onSave,
    readClipboardText,
    writeClipboardText,
    themeKind,
    loc,
}: {
    slot: QuickQuerySlot;
    slotName: string;
    open: boolean;
    onClose: () => void;
    onSave: (query: string) => void;
    readClipboardText: () => Promise<string>;
    writeClipboardText: (text: string) => Promise<void>;
    themeKind: ColorThemeKind;
    loc: typeof locConstants.shortcutsConfiguration;
}) => {
    const classes = useStyles();
    const draftRef = useRef(slot.query);
    const editorRef = useRef<MonacoEditor | null>(null);
    const surfaceRef = useRef<HTMLDivElement | null>(null);

    useOutsidePointerClose(surfaceRef, open, onClose);

    useEffect(() => {
        if (open) {
            draftRef.current = slot.query;
            editorRef.current?.setValue(slot.query);
            window.requestAnimationFrame(() => editorRef.current?.focus());
        }
    }, [open, slot.query]);

    const pasteIntoEditor = useCallback(async () => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }

        let clipboardText = "";
        try {
            clipboardText = await readClipboardText();
        } catch {
            try {
                clipboardText = await navigator.clipboard.readText();
            } catch {
                clipboardText = "";
            }
        }

        insertTextIntoEditor(editor, clipboardText);
        draftRef.current = editor.getValue();
        editor.focus();
    }, [readClipboardText]);

    const cutFromEditor = useCallback(async () => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }

        const edits = getCutEdits(editor);
        const clipboardText = edits.map((edit) => edit.clipboardText).join("");
        if (!clipboardText) {
            return;
        }

        try {
            await writeClipboardText(clipboardText);
        } catch {
            try {
                await navigator.clipboard.writeText(clipboardText);
            } catch {
                return;
            }
        }

        deleteCutEdits(editor, edits);
        draftRef.current = editor.getValue();
        editor.focus();
    }, [writeClipboardText]);

    const onEditorKeyDownCapture = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (!isPasteShortcut(event) && !isCutShortcut(event)) {
                return;
            }

            const editor = editorRef.current;
            if (!editor?.hasTextFocus()) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            if (isPasteShortcut(event)) {
                void pasteIntoEditor();
            } else {
                void cutFromEditor();
            }
        },
        [cutFromEditor, pasteIntoEditor],
    );

    const onEditorPasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
        const editor = editorRef.current;
        if (!editor?.hasTextFocus()) {
            return;
        }

        const clipboardText = event.clipboardData.getData("text/plain");
        if (!clipboardText) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        insertTextIntoEditor(editor, clipboardText);
        draftRef.current = editor.getValue();
        editor.focus();
    }, []);

    const onEditorCutCapture = useCallback(
        (event: ReactClipboardEvent<HTMLDivElement>) => {
            const editor = editorRef.current;
            if (!editor?.hasTextFocus()) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void cutFromEditor();
        },
        [cutFromEditor],
    );

    return (
        <Dialog
            open={open}
            modalType="non-modal"
            onOpenChange={(_event, data) => {
                if (!data.open) {
                    onClose();
                }
            }}>
            <DialogSurface ref={surfaceRef} className={classes.queryDialog}>
                <DialogBody>
                    <DialogTitle>{loc.queryDialogTitle(slotName)}</DialogTitle>
                    <DialogContent className={classes.queryDialogContent}>
                        <Field className={classes.field} label={loc.query}>
                            <MessageBar intent="info">
                                <MessageBarBody>{loc.selectedTextArgumentHint}</MessageBarBody>
                            </MessageBar>
                            <div
                                className={classes.monacoShell}
                                onKeyDownCapture={onEditorKeyDownCapture}
                                onCutCapture={onEditorCutCapture}
                                onPasteCapture={onEditorPasteCapture}
                                data-tabster='{"focusable": {"ignoreKeydown": {"Tab": true}}, "uncontrolled": {}}'>
                                <VscodeEditor
                                    height="100%"
                                    width="100%"
                                    language="sql"
                                    themeKind={themeKind}
                                    defaultValue={slot.query}
                                    options={{
                                        minimap: { enabled: false },
                                        scrollBeyondLastLine: false,
                                        wordWrap: "on",
                                        lineNumbers: "on",
                                        glyphMargin: false,
                                        folding: true,
                                        lineDecorationsWidth: 8,
                                        overviewRulerLanes: 0,
                                        renderLineHighlight: "line",
                                        automaticLayout: true,
                                        pasteAs: { enabled: false },
                                        dropIntoEditor: { enabled: false },
                                        tabFocusMode: false,
                                        ariaLabel: loc.queryEditorAriaLabel(slotName),
                                    }}
                                    onChange={(value) => {
                                        draftRef.current = value ?? "";
                                    }}
                                    onMount={(editor, monaco) => {
                                        const completionProvider =
                                            registerSelectedTextCompletionProvider(
                                                editor,
                                                monaco,
                                                loc,
                                            );
                                        editor.addCommand(
                                            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV,
                                            () => {
                                                void pasteIntoEditor();
                                            },
                                        );
                                        editor.addCommand(
                                            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX,
                                            () => {
                                                void cutFromEditor();
                                            },
                                        );
                                        editorRef.current = editor;
                                        draftRef.current = editor.getValue();
                                        editor.focus();
                                        editor.onDidDispose(() => {
                                            completionProvider?.dispose();
                                            if (editorRef.current === editor) {
                                                editorRef.current = null;
                                            }
                                        });
                                    }}
                                />
                            </div>
                        </Field>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {locConstants.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            onClick={() =>
                                onSave(editorRef.current?.getValue() ?? draftRef.current)
                            }>
                            {locConstants.common.save}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export const WebviewShortcutRow = ({
    item,
    value,
    onRecord,
    loc,
    searchTerm,
}: {
    item: ShortcutItem;
    value: string;
    onRecord: () => void;
    loc: typeof locConstants.shortcutsConfiguration;
    searchTerm: string;
}) => {
    const classes = useStyles();

    return (
        <div className={classes.webviewShortcutRow}>
            <div>
                <Text className={classes.rowLabel}>
                    <HighlightedText
                        text={loc.webviewShortcutLabels[item.action]}
                        searchTerm={searchTerm}
                    />
                </Text>
                <Text className={classes.rowDescription}>
                    <HighlightedText
                        text={loc.webviewShortcutDescriptions[item.action]}
                        searchTerm={searchTerm}
                    />
                </Text>
            </div>
            <ShortcutChip
                value={value}
                onRecord={onRecord}
                recordLabel={`${loc.recordShortcut}: ${loc.webviewShortcutLabels[item.action]}`}
            />
        </div>
    );
};

export const ConfigurableKeyCommandRow = ({
    item,
    onOpen,
    loc,
    searchTerm,
}: {
    item: ConfigurableKeyCommand;
    onOpen: () => void;
    loc: typeof locConstants.shortcutsConfiguration;
    searchTerm: string;
}) => {
    const classes = useStyles();
    const label = loc.configurableKeyCommandLabels[item.command];
    const description = loc.configurableKeyCommandDescriptions[item.command];

    return (
        <div className={classes.webviewShortcutRow}>
            <div>
                <Text className={classes.rowLabel}>
                    <HighlightedText text={label} searchTerm={searchTerm} />
                </Text>
                <Text className={classes.rowDescription}>
                    <HighlightedText text={description} searchTerm={searchTerm} />
                </Text>
            </div>
            <VscodeManagedShortcutAction
                onOpen={onOpen}
                label={loc.viewConfigureKeybindingTooltip(label)}
            />
        </div>
    );
};
