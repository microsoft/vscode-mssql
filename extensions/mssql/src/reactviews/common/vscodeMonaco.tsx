/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TinyColor } from "@ctrl/tinycolor";
import {
    BeforeMount,
    DiffBeforeMount,
    DiffEditor,
    DiffEditorProps,
    Editor,
    EditorProps,
    Monaco,
    loader,
} from "@monaco-editor/react";
import { useCallback, useEffect, useRef } from "react";
import { ColorThemeKind } from "../../sharedInterfaces/webview";

const VSCODE_MONACO_THEME_NAME = "vscode-webview-theme";
const THEME_ATTRIBUTE_NAMES = ["class", "data-vscode-theme-id", "data-vscode-theme-kind"];

type MonacoBuiltinTheme = "vs" | "vs-dark" | "hc-black" | "hc-light";

const MONACO_COLOR_MAP: Record<string, string> = {
    focusBorder: "--vscode-focusBorder",
    contrastBorder: "--vscode-contrastBorder",
    contrastActiveBorder: "--vscode-contrastActiveBorder",
    "editor.background": "--vscode-editor-background",
    "editor.foreground": "--vscode-editor-foreground",
    "editorCursor.foreground": "--vscode-editorCursor-foreground",
    "editor.selectionBackground": "--vscode-editor-selectionBackground",
    "editor.inactiveSelectionBackground": "--vscode-editor-inactiveSelectionBackground",
    "editor.selectionHighlightBackground": "--vscode-editor-selectionHighlightBackground",
    "editor.wordHighlightBackground": "--vscode-editor-wordHighlightBackground",
    "editor.wordHighlightStrongBackground": "--vscode-editor-wordHighlightStrongBackground",
    "editor.findMatchBackground": "--vscode-editor-findMatchBackground",
    "editor.findMatchHighlightBackground": "--vscode-editor-findMatchHighlightBackground",
    "editor.lineHighlightBackground": "--vscode-editor-lineHighlightBackground",
    "editor.lineHighlightBorder": "--vscode-editor-lineHighlightBorder",
    "editorWhitespace.foreground": "--vscode-editorWhitespace-foreground",
    "editorIndentGuide.background1": "--vscode-editorIndentGuide-background1",
    "editorIndentGuide.activeBackground1": "--vscode-editorIndentGuide-activeBackground1",
    "editorLineNumber.foreground": "--vscode-editorLineNumber-foreground",
    "editorLineNumber.activeForeground": "--vscode-editorLineNumber-activeForeground",
    "editorGutter.background": "--vscode-editorGutter-background",
    "editorGutter.modifiedBackground": "--vscode-editorGutter-modifiedBackground",
    "editorGutter.addedBackground": "--vscode-editorGutter-addedBackground",
    "editorGutter.deletedBackground": "--vscode-editorGutter-deletedBackground",
    "editorWidget.background": "--vscode-editorWidget-background",
    "editorWidget.border": "--vscode-editorWidget-border",
    "editorHoverWidget.background": "--vscode-editorHoverWidget-background",
    "editorHoverWidget.border": "--vscode-editorHoverWidget-border",
    "editorSuggestWidget.background": "--vscode-editorSuggestWidget-background",
    "editorSuggestWidget.border": "--vscode-editorSuggestWidget-border",
    "editorSuggestWidget.foreground": "--vscode-editorSuggestWidget-foreground",
    "editorSuggestWidget.selectedBackground": "--vscode-editorSuggestWidget-selectedBackground",
    "scrollbarSlider.background": "--vscode-scrollbarSlider-background",
    "scrollbarSlider.hoverBackground": "--vscode-scrollbarSlider-hoverBackground",
    "scrollbarSlider.activeBackground": "--vscode-scrollbarSlider-activeBackground",
    "editorOverviewRuler.border": "--vscode-editorOverviewRuler-border",
    "minimap.selectionHighlight": "--vscode-minimap-selectionHighlight",
    "minimap.findMatchHighlight": "--vscode-minimap-findMatchHighlight",
    "editorBracketMatch.background": "--vscode-editorBracketMatch-background",
    "editorBracketMatch.border": "--vscode-editorBracketMatch-border",
    "diffEditor.insertedTextBackground": "--vscode-diffEditor-insertedTextBackground",
    "diffEditor.removedTextBackground": "--vscode-diffEditor-removedTextBackground",
    "diffEditor.insertedLineBackground": "--vscode-diffEditor-insertedLineBackground",
    "diffEditor.removedLineBackground": "--vscode-diffEditor-removedLineBackground",
    "diffEditor.diagonalFill": "--vscode-diffEditor-diagonalFill",
};

function resolveMonacoBaseTheme(themeKind: ColorThemeKind): MonacoBuiltinTheme {
    switch (themeKind) {
        case ColorThemeKind.Dark:
            return "vs-dark";
        case ColorThemeKind.HighContrast:
            return "hc-black";
        case ColorThemeKind.HighContrastLight:
            return "hc-light";
        case ColorThemeKind.Light:
        default:
            return "vs";
    }
}

function getThemeTargetElement(): HTMLElement {
    return document.body ?? document.documentElement;
}

function getCssVariable(variableName: string): string | undefined {
    if (typeof document === "undefined") {
        return undefined;
    }

    const value = window
        .getComputedStyle(getThemeTargetElement())
        .getPropertyValue(variableName)
        .trim();

    if (!value) {
        return undefined;
    }

    const color = new TinyColor(value);
    if (!color.isValid) {
        return undefined;
    }

    return color.getAlpha() < 1 ? color.toHex8String() : color.toHexString();
}

function getMonacoColors(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(MONACO_COLOR_MAP).flatMap(([monacoColor, cssVariable]) => {
            const value = getCssVariable(cssVariable);
            return value ? [[monacoColor, value]] : [];
        }),
    );
}

function defineVscodeMonacoTheme(monaco: Monaco, themeKind: ColorThemeKind): void {
    monaco.editor.defineTheme(VSCODE_MONACO_THEME_NAME, {
        base: resolveMonacoBaseTheme(themeKind),
        inherit: true,
        rules: [],
        colors: getMonacoColors(),
    });

    monaco.editor.setTheme(VSCODE_MONACO_THEME_NAME);
}
function useVscodeMonacoTheme(themeKind: ColorThemeKind): BeforeMount {
    const frameHandleRef = useRef<number | undefined>(undefined);

    const applyTheme = useCallback<BeforeMount>(
        (monaco: Monaco) => {
            defineVscodeMonacoTheme(monaco, themeKind);
        },
        [themeKind],
    );

    useEffect(() => {
        if (typeof document === "undefined") {
            return;
        }

        let disposed = false;
        const observerTarget = getThemeTargetElement();

        const queueThemeRefresh = () => {
            if (frameHandleRef.current !== undefined) {
                cancelAnimationFrame(frameHandleRef.current);
            }

            frameHandleRef.current = requestAnimationFrame(() => {
                frameHandleRef.current = undefined;
                void loader.init().then((monaco) => {
                    if (disposed) {
                        return;
                    }

                    applyTheme(monaco);
                });
            });
        };

        queueThemeRefresh();

        const observer = new MutationObserver(queueThemeRefresh);
        observer.observe(observerTarget, {
            attributes: true,
            attributeFilter: THEME_ATTRIBUTE_NAMES,
        });

        return () => {
            disposed = true;
            observer.disconnect();
            if (frameHandleRef.current !== undefined) {
                cancelAnimationFrame(frameHandleRef.current);
                frameHandleRef.current = undefined;
            }
        };
    }, [applyTheme]);

    return applyTheme;
}

type VscodeEditorProps = Omit<EditorProps, "theme"> & {
    themeKind: ColorThemeKind;
};

export function VscodeEditor({ themeKind, beforeMount, ...props }: VscodeEditorProps) {
    const monacoBeforeMount = useVscodeMonacoTheme(themeKind);

    const combinedBeforeMount = useCallback<BeforeMount>(
        (monaco) => {
            monacoBeforeMount(monaco);
            beforeMount?.(monaco);
        },
        [beforeMount, monacoBeforeMount],
    );

    return <Editor {...props} theme={VSCODE_MONACO_THEME_NAME} beforeMount={combinedBeforeMount} />;
}

type VscodeDiffEditorProps = Omit<DiffEditorProps, "theme"> & {
    themeKind: ColorThemeKind;
};

export function VscodeDiffEditor({ themeKind, beforeMount, ...props }: VscodeDiffEditorProps) {
    const monacoBeforeMount = useVscodeMonacoTheme(themeKind);

    const combinedBeforeMount = useCallback<DiffBeforeMount>(
        (monaco) => {
            monacoBeforeMount(monaco);
            beforeMount?.(monaco);
        },
        [beforeMount, monacoBeforeMount],
    );

    return (
        <DiffEditor {...props} theme={VSCODE_MONACO_THEME_NAME} beforeMount={combinedBeforeMount} />
    );
}
