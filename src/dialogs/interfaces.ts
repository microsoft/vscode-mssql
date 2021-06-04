/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Valid values for the position CSS property
 */
export type PositionType = 'static' | 'absolute' | 'fixed' | 'relative' | 'sticky' | 'initial' | 'inherit';

/**
     * Valid values for the display CSS property
     */
export type DisplayType =
    'inline' |
    'block' |
    'contents' |
    'flex' |
    'grid' |
    'inline-block' |
    'inline-flex' |
    'inline-grid' |
    'inline-table' |
    'list-item' |
    'run-in' |
    'table' |
    'table-caption' |
    ' table-column-group' |
    'table-header-group' |
    'table-footer-group' |
    'table-row-group' |
    'table-cell' |
    'table-column' |
    'table-row' |
    'none' |
    'initial' |
    'inherit' |
    '';

/**
 * Set of CSS key-value pairs
 */
export type CssStyles = { [key: string]: string | number };

export interface ComponentProperties {
    height?: number | string;
    width?: number | string;
    /**
     * The position CSS property. Empty by default.
     * This is particularly useful if laying out components inside a FlexContainer and
     * the size of the component is meant to be a fixed size. In this case the position must be
     * set to 'absolute', with the parent FlexContainer having 'relative' position.
     * Without this the component will fail to correctly size itself
     */
    position?: PositionType;
    /**
     * Whether the component is enabled in the DOM
     */
    enabled?: boolean;
    /**
     * Corresponds to the display CSS property for the element
     */
    display?: DisplayType;
    /**
     * Corresponds to the aria-label accessibility attribute for this component
     */
    ariaLabel?: string;
    /**
     * Corresponds to the role accessibility attribute for this component
     */
    ariaRole?: string;
    /**
     * Corresponds to the aria-selected accessibility attribute for this component
     */
    ariaSelected?: boolean;
    /**
     * Corresponds to the aria-hidden accessibility attribute for this component
     */
    ariaHidden?: boolean;
    /**
     * Matches the CSS style key and its available values.
     */
    CSSStyles?: CssStyles;
}


export interface Component extends ComponentProperties {
    readonly id: string;

    /**
     * Sends any updated properties of the component to the UI
     *
     * @returns Thenable that completes once the update
     * has been applied in the UI
     */
    updateProperties(properties: { [key: string]: any }): Thenable<void>;

    /**
     * Sends an updated property of the component to the UI
     *
     * @returns Thenable that completes once the update
     * has been applied in the UI
     */
    updateProperty(key: string, value: any): Thenable<void>;

    /**
     * Updates the specified CSS Styles and notifies the UI
     * @param cssStyles The styles to update
     * @returns Thenable that completes once the update has been applied to the UI
     */
    updateCssStyles(cssStyles: CssStyles): Thenable<void>;

    /**
     * Event fired to notify that the component's validity has changed
     */
    readonly onValidityChanged: vscode.Event<boolean>;

    /**
     * Whether the component is valid or not
     */
    readonly valid: boolean;

    /**
     * Run the component's validations
     */
    validate(): Thenable<boolean>;

    /**
     * Focuses the component.
     */
    focus(): Thenable<void>;
}

export interface ComponentBuilder<TComponent extends Component, TPropertyBag extends ComponentProperties> {
    component(): TComponent;
    withProperties<U>(properties: U): ComponentBuilder<TComponent, TPropertyBag>;
    withValidation(validation: (component: TComponent) => boolean | Thenable<boolean>): ComponentBuilder<TComponent, TPropertyBag>;
}

export interface ContainerBuilder<TComponent extends Component, TLayout, TItemLayout, TPropertyBag extends ComponentProperties> extends ComponentBuilder<TComponent, TPropertyBag> {
    withLayout(layout: TLayout): ContainerBuilder<TComponent, TLayout, TItemLayout, TPropertyBag>;
    withItems(components: Array<Component>, itemLayout?: TItemLayout): ContainerBuilder<TComponent, TLayout, TItemLayout, TPropertyBag>;
}

/**
 * Supports defining a model that can be instantiated as a view in the UI
 */
export interface ModelBuilder {
    // navContainer(): ContainerBuilder<NavContainer, any, any, ComponentProperties>;
    // divContainer(): DivBuilder;
    // flexContainer(): FlexBuilder;
    // splitViewContainer(): SplitViewBuilder;
    // /**
    //  * @deprecated please use radioCardGroup component.
    //  */
    // card(): ComponentBuilder<CardComponent, CardProperties>;
    // inputBox(): ComponentBuilder<InputBoxComponent, InputBoxProperties>;
    // checkBox(): ComponentBuilder<CheckBoxComponent, CheckBoxProperties>;
    // radioButton(): ComponentBuilder<RadioButtonComponent, RadioButtonProperties>;
    // webView(): ComponentBuilder<WebViewComponent, WebViewProperties>;
    // editor(): ComponentBuilder<EditorComponent, EditorProperties>;
    // diffeditor(): ComponentBuilder<DiffEditorComponent, DiffEditorComponent>;
    // text(): ComponentBuilder<TextComponent, TextComponentProperties>;
    // image(): ComponentBuilder<ImageComponent, ImageComponentProperties>;
    button(): ComponentBuilder<ButtonComponent, ButtonProperties>;
    // dropDown(): ComponentBuilder<DropDownComponent, DropDownProperties>;
    // tree<T>(): ComponentBuilder<TreeComponent<T>, TreeProperties>;
    // listBox(): ComponentBuilder<ListBoxComponent, ListBoxProperties>;
    // table(): ComponentBuilder<TableComponent, TableComponentProperties>;
    // declarativeTable(): ComponentBuilder<DeclarativeTableComponent, DeclarativeTableProperties>;
    // dashboardWidget(widgetId: string): ComponentBuilder<DashboardWidgetComponent, ComponentProperties>;
    // dashboardWebview(webviewId: string): ComponentBuilder<DashboardWebviewComponent, ComponentProperties>;
    // formContainer(): FormBuilder;
    // groupContainer(): GroupBuilder;
    // toolbarContainer(): ToolbarBuilder;
    // loadingComponent(): LoadingComponentBuilder;
    // fileBrowserTree(): ComponentBuilder<FileBrowserTreeComponent, FileBrowserTreeProperties>;
    // hyperlink(): ComponentBuilder<HyperlinkComponent, HyperlinkComponentProperties>;
    // separator(): ComponentBuilder<SeparatorComponent, SeparatorComponentProperties>;
    // infoBox(): ComponentBuilder<InfoBoxComponent, InfoBoxComponentProperties>;
    // propertiesContainer(): ComponentBuilder<PropertiesContainerComponent, PropertiesContainerComponentProperties>;
}

/**
 * A view backed by a model provided by an extension.
 * This model contains enough information to lay out the view
 */
export interface ModelView {
    /**
     * Raised when the view closed.
     */
    readonly onClosed: vscode.Event<any>;

    /**
     * The model backing the model-based view
     */
    readonly modelBuilder: ModelBuilder;

    /**
     * Whether or not the model view's root component is valid
     */
    readonly valid: boolean;

    /**
     * Raised when the model view's valid property changes
     */
    readonly onValidityChanged: vscode.Event<boolean>;

    /**
     * Run the model view root component's validations
     */
    validate(): Thenable<boolean>;

    /**
     * Initializes the model with a root component definition.
     * Once this has been done, the components will be laid out in the UI and
     * can be accessed and altered as needed.
     */
    initializeModel<T extends Component>(root: T): Thenable<void>;
}


export interface ModelViewPanel {
    /**
     * Register model view content for the dialog.
     * Doesn't do anything if model view is already registered
     */
    registerContent(handler: (view: ModelView) => Thenable<void>): void;

    /**
     * Returns the model view content if registered. Returns undefined if model review is not registered
     */
    readonly modelView: ModelView;

    /**
     * Whether the panel's content is valid
     */
    readonly valid: boolean;

    /**
     * Fired whenever the panel's valid property changes
     */
    readonly onValidityChanged: vscode.Event<boolean>;
}

// Model view dialog classes
export interface Dialog extends ModelViewPanel {
    /**
     * The title of the dialog
     */
    title: string;

    /**
     * Indicates the width of the dialog
     */
    isWide: boolean;

    /**
     * The content of the dialog. If multiple tabs are given they will be displayed with tabs
     * If a string is given, it should be the ID of the dialog's model view content
     */
    content: string | DialogTab[];

    /**
     * The ok button
     */
    okButton: Button;

    /**
     * The cancel button
     */
    cancelButton: Button;

    /**
     * Any additional buttons that should be displayed
     */
    customButtons: Button[];

    /**
     * Set the informational message shown in the dialog. Hidden when the message is
     * undefined or the text is empty or undefined. The default level is error.
     */
    message: DialogMessage;

    /**
     * Set the dialog name when opening
     * the dialog for telemetry
     */
    dialogName?: string;

    /**
     * Register a callback that will be called when the user tries to click done. Only
     * one callback can be registered at once, so each registration call will clear
     * the previous registration.
     * @param validator The callback that gets executed when the user tries to click
     * done. Return true to allow the dialog to close or false to block it from closing
     */
    registerCloseValidator(validator: () => boolean | Thenable<boolean>): void;

    // /**
    //  * Register an operation to run in the background when the dialog is done
    //  * @param operationInfo Operation Information
    //  */
    // registerOperation(operationInfo: BackgroundOperationInfo): void;
}

export interface Button {
    /**
     * The label displayed on the button
     */
    label: string;

    /**
     * Whether the button is enabled
     */
    enabled: boolean;

    /**
     * Whether the button is hidden
     */
    hidden: boolean;

    /**
     * Whether the button is focused
     */
    focused?: boolean;

    /**
     * Raised when the button is clicked
     */
    readonly onClick: vscode.Event<void>;

    /**
     * Position of the button on the dialog footer
     */
    position?: DialogButtonPosition;
}

export interface ButtonComponent extends Component, ButtonProperties {
    /**
     * An event called when the button is clicked
     */
    onDidClick: vscode.Event<any>;
}

export interface ButtonProperties extends ComponentProperties, ComponentWithIcon {
    /**
     * The label for the button
     */
    label?: string;
    /**
     * Whether the button opens the file browser dialog
     */
    isFile?: boolean;
    /**
     * The content of the currently selected file
     */
    fileContent?: string;
    /**
     * @deprecated This will be moved to `ComponentWithIconProperties`
     *
     * The title for the button. This title will show when hovered over
     */
    title?: string;
}


export type DialogButtonPosition = 'left' | 'right';

export interface DialogTab extends ModelViewPanel {
    /**
     * The title of the tab
     */
    title: string;

    /**
     * A string giving the ID of the tab's model view content
     */
    content: string;
}

/**
 * A message shown in a dialog. If the level is not set it defaults to error.
 */
export type DialogMessage = {
    readonly text: string,
    readonly description?: string,
    readonly level?: MessageLevel
};

/**
 * Used to control whether a message in a dialog/wizard is displayed as an error,
 * warning, or informational message. Default is error.
 */
export enum MessageLevel {
    Error = 0,
    Warning = 1,
    Information = 2
}


export interface ComponentWithIcon extends ComponentWithIconProperties { }

export interface ComponentWithIconProperties extends ComponentProperties {
    /**
     * The path for the icon with optional dark-theme away alternative
     */
    iconPath?: IconPath;
    /**
     * The height of the icon
     */
    iconHeight?: number | string;
    /**
     * The width of the icon
     */
    iconWidth?: number | string;
    /**
     * The title for the icon. This title will show when hovered over
     */
    title?: string;
}

export type ThemedIconPath = { light: string | vscode.Uri; dark: string | vscode.Uri };
export type IconPath = string | vscode.Uri | ThemedIconPath;
