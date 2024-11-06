/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fluentui from "@fluentui/react-components";

export const webviewTheme: fluentui.Theme = {
    ...fluentui.webLightTheme,
    colorNeutralBackground1: "var(--vscode-editor-background)",
    colorNeutralForeground1: "var(--vscode-editor-foreground)",
    colorBrandBackground: "var(--vscode-button-background)",
    colorBrandBackgroundHover: "var(--vscode-button-hoverBackground)",
    colorNeutralForegroundOnBrand: "var(--vscode-button-foreground)",
    colorNeutralBackground1Hover:
        "var(--vscode-button-secondaryHoverBackground)",
    colorNeutralForeground1Hover: "var(--vscode-editor-foreground)",
    colorNeutralForeground2: "var(--vscode-editor-foreground)",
    colorNeutralForeground2Hover:
        "var(--vscode-editorHoverWidget-highlightForeground)",
    colorSubtleBackgroundHover: "var(--vscode-list-hoverBackground)",
    colorNeutralForeground2Pressed:
        "var(--vscode-list-activeSelectionForeground)",
    colorSubtleBackgroundPressed:
        "var(--vscode-list-activeSelectionBackground)",
    colorBrandStroke1: "var(--vscode-button-foreground)",
    colorBrandStroke2Contrast: "var(--vscode-button-background)",
    colorCompoundBrandStroke: "var(--vscode-button-background)",
    colorCompoundBrandStrokeHover: "var(--vscode-button-hoverBackground)",
    colorCompoundBrandBackground: "var(--vscode-button-background)",
    colorNeutralForegroundInverted: "var(--vscode-button-foreground)",
    colorCompoundBrandBackgroundHover: "var(--vscode-button-hoverBackground)",
    colorCompoundBrandBackgroundPressed: "var(--vscode-button-hoverBackground)",
    colorNeutralForeground2BrandHover:
        "var(--vscode-editorHoverWidget-highlightForeground)",
    colorNeutralForeground2BrandPressed:
        "var(--vscode-button-secondaryForeground)",
    colorNeutralForeground3: "var(--vscode-foreground)",
    colorCompoundBrandForeground1: "var(--vscode-button-background)",
    colorStrokeFocus1: "var(--vscode-focusBorder)",
    colorStrokeFocus2: "var(--vscode-focusBorder)",
    colorBrandForegroundLink: "var(--vscode-textLink-foreground)",
    colorBrandForegroundLinkHover:
        "var(--vscode-editorHoverWidget-highlightForeground)",
    colorBrandForegroundLinkPressed:
        "var(--vscode-editorHoverWidget-highlightForeground)",
    colorCompoundBrandForeground1Hover:
        "var(--vscode-editorHoverWidget-highlightForeground)",
    colorCompoundBrandForeground1Pressed:
        "var(--vscode-editorHoverWidget-highlightForeground)",
    colorNeutralBackgroundDisabled:
        "var(--vscode-list-inactiveSelectionBackground)",
    colorNeutralStroke2: "var(--vscode-editorWidget-border)",
    colorNeutralBackground2: "var(--vscode-keybindingTable-headerBackground)",
    colorNeutralStroke1: "var(--vscode-foreground)",
    /**
     * This specifies the border color for input elements.
     */
    colorNeutralStrokeAccessible: "var(--vscode-foreground)",
    /**
     * This specifies the color of the text in disabled input elements.
     */
    colorNeutralForegroundDisabled: "var(--vscode-disabledForeground)",
    /**
     * This specifies the border color for the disabled input elements
     */
    colorNeutralStrokeDisabled: "var(--vscode-disabledForeground)",
    /**
     * This specifies the color of the error icon in the message box and other error indicators
     */
    colorStatusDangerForeground1: "var(--vscode-errorForeground)",
    /**
     * The specifies the border color for an error message box
     */
    colorStatusDangerBorder1: "var(--vscode-errorForeground)",
    // This specifies the background color for an error message box
    colorStatusDangerBackground1:
        "var(--vscode-diffEditor-removedTextBackground)",
};
