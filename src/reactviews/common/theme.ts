/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fluentui from "@fluentui/react-components";
import { ColorThemeKind } from "../../sharedInterfaces/webview";

/**
 * This maps the Fluent UI theme variables to the VS Code theme variables.
 */
export function webviewTheme(themeKind: ColorThemeKind): fluentui.Theme {
    let baseTheme;

    switch (themeKind) {
        case ColorThemeKind.Light:
        case ColorThemeKind.HighContrastLight:
            baseTheme = fluentui.webLightTheme;
            break;
        case ColorThemeKind.Dark:
        case ColorThemeKind.HighContrast:
        default:
            baseTheme = fluentui.webDarkTheme;
            break;
    }

    return {
        ...baseTheme,
        colorNeutralBackground1: "var(--vscode-editor-background)",
        colorNeutralForeground1: "var(--vscode-editor-foreground)",
        colorBrandBackground: "var(--vscode-button-background)",
        colorBrandBackground2: "var(--vscode-list-inactiveSelectionBackground)",
        colorBrandBackgroundHover: "var(--vscode-button-hoverBackground)",
        colorBrandBackground2Hover: "var(--vscode-button-hoverBackground)",
        colorBrandForeground2: "var(--vscode-list-inactiveSelectionForeground)",
        colorNeutralForegroundOnBrand: "var(--vscode-button-foreground)",
        /**
         * Background color for a dropdown option that is hovered over.
         */
        colorNeutralBackground1Hover: "var(--vscode-dropdown-background)",
        colorNeutralForeground1Hover: "var(--vscode-editor-foreground)",
        colorNeutralBackgroundInverted: "var(--vscode-editor-selectionBackground)",
        /**
         * Background color for a pressed state of a secondary button.
         */
        colorNeutralBackground1Pressed: "var(--vscode-dropdown-background)",
        /**
         * Foreground color for a pressed state of a secondary button.
         */
        colorNeutralForeground1Pressed: "var(--vscode-editor-foreground)",
        colorNeutralForeground2: "var(--vscode-editor-foreground)",
        colorNeutralForeground2Hover: "var(--vscode-editorHoverWidget-highlightForeground)",
        colorSubtleBackgroundHover: "var(--vscode-list-hoverBackground)",
        colorNeutralForeground2Pressed: "var(--vscode-list-activeSelectionForeground)",
        colorSubtleBackgroundPressed: "var(--vscode-list-activeSelectionBackground)",
        colorBrandStroke1: "var(--vscode-button-foreground)",
        colorBrandStroke2Contrast: "var(--vscode-button-background)",
        /**
         * Specifies the focus border color for components that are in focus.
         */
        colorCompoundBrandStroke: "var(--vscode-focusBorder)",
        colorCompoundBrandStrokeHover: "var(--vscode-button-hoverBackground)",
        colorCompoundBrandBackground: "var(--vscode-button-background)",
        colorNeutralForegroundInverted: "var(--vscode-button-foreground)",
        colorCompoundBrandBackgroundHover: "var(--vscode-button-hoverBackground)",
        colorCompoundBrandBackgroundPressed: "var(--vscode-button-hoverBackground)",
        colorNeutralForeground2BrandHover: "var(--vscode-editorHoverWidget-highlightForeground)",
        colorNeutralForeground2BrandPressed: "var(--vscode-button-secondaryForeground)",
        colorNeutralForeground3: "var(--vscode-foreground)",
        colorCompoundBrandForeground1: "var(--vscode-button-background)",
        colorStrokeFocus1: "var(--vscode-focusBorder)",
        colorStrokeFocus2: "var(--vscode-focusBorder)",
        colorBrandForegroundLink: "var(--vscode-textLink-foreground)",
        colorBrandForegroundLinkHover: "var(--vscode-editorHoverWidget-highlightForeground)",
        colorBrandForegroundLinkPressed: "var(--vscode-editorHoverWidget-highlightForeground)",
        colorCompoundBrandForeground1Hover: "var(--vscode-editorHoverWidget-highlightForeground)",
        colorCompoundBrandForeground1Pressed: "var(--vscode-editorHoverWidget-highlightForeground)",
        colorNeutralBackgroundDisabled: "var(--vscode-list-inactiveSelectionBackground)",
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
        colorStatusDangerBackground1: "var(--vscode-diffEditor-removedTextBackground)",
        colorStatusWarningBackground1: "var(----vscode-minimap-warningHighlight)",
        fontSizeBase300: "13px",
        fontFamilyBase: "var(--vscode-font-family)",
        fontFamilyNumeric: "var(--vscode-font-family)",
        fontFamilyMonospace: "var(--vscode-editor-font-family)",
        lineHeightBase300: "1.4em",
        /**
         * Specifies the background color for a selected div.
         */
        colorNeutralForeground2BrandSelected: "var(--vscode-button-background)",
        /**
         * Specified the shadow color for card components.
         */
        shadow4: "0 0 2px var(--vscode-widget-shadow), 0 2px 4px var(--vscode-widget-shadow)",
        /**
         * Specifies the shadow color for popover components.
         */
        colorNeutralShadowAmbient: "var(--vscode-widget-shadow)",
        /**
         * Specifies the shadow color for popover components.
         */
        colorNeutralShadowKey: "var(--vscode-widget-shadow)",
        /**
         * Color for the background of a selected item in a subtle button.
         */
        colorSubtleBackgroundSelected: "var(--vscode-menu-selectionBackground)",
        /**
         * Color for the foreground of a selected item in a subtle button.
         */
        colorNeutralForeground1Selected: "var(--vscode-menu-selectionForeground)",
        /**
         * Color for the background of a toggle button when it is selected.
         */
        colorNeutralBackground1Selected: "var(--vscode-list-inactiveSelectionBackground)",
    };
}
