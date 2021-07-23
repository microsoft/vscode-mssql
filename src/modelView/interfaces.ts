/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogImpl } from './dialogImpl';
import { generateGuid } from '../models/utils';
import { ModelViewImpl } from './modelViewImpl';
import { createProxy, IMessageProtocol, IServerProxy, IWebviewProxy } from './modelViewProtocol';
import { readFile as fsreadFile } from 'fs';
import { promisify } from 'util';
import * as ejs from 'ejs';
import * as path from 'path';
import * as azdata from './interfaces';
import * as vscode from 'vscode';
import { ButtonImpl } from './buttonImpl';
import { ComponentImpl, InternalItemConfig } from './componentImpl';

let context: vscode.ExtensionContext = undefined;
let dialogService: DialogService = undefined;
export function initializeModelView(c: vscode.ExtensionContext): void {
    context = c;
    dialogService = new DialogService(context);
}

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

export interface IItemConfig {
	componentShape: IComponentShape;
	config: any;
}

export interface IComponentShape {
	type: ModelComponentTypes;
	id: string;
	properties?: { [key: string]: any };
	layout?: any;
	itemConfigs?: IItemConfig[];
}

export enum ComponentEventType {
	PropertiesChanged,
	onDidChange,
	onDidClick,
	validityChanged,
	onMessage,
	onSelectedRowChanged,
	onComponentCreated,
	onCellAction,
	onEnterKeyPressed,
	onInput
}

export enum ModelViewAction {
	SelectTab = 'selectTab',
	AppendData = 'appendData',
	Filter = 'filter'
}

export interface IComponentEventArgs {
	eventType: ComponentEventType;
	args: any;
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
	 * A component that contains other components
	 */
 export interface Container<TLayout, TItemLayout> extends Component {
    /**
     * A copy of the child items array. This cannot be added to directly -
     * components must be created using the create methods instead
     */
    readonly items: Component[];

    /**
     * Removes all child items from this container
     */
    clearItems(): void;
    /**
     * Creates a collection of child components and adds them all to this container
     *
     * @param itemConfigs the definitions
     * @param [itemLayout] Optional layout for the child items
     */
    addItems(itemConfigs: Array<Component>, itemLayout?: TItemLayout): void;

    /**
     * Creates a child component and adds it to this container.
     * Adding component to multiple containers is not supported
     *
     * @param component the component to be added
     * @param [itemLayout] Optional layout for this child item
     */
    addItem(component: Component, itemLayout?: TItemLayout): void;

    /**
     * Creates a child component and inserts it to this container. Returns error given invalid index
     * Adding component to multiple containers is not supported
     * @param component the component to be added
     * @param index the index to insert the component to
     * @param [itemLayout] Optional layout for this child item
     */
    insertItem(component: Component, index: number, itemLayout?: TItemLayout): void;

    /**
     *
     * @param component Removes a component from this container
     */
    removeItem(component: Component): boolean;

    /**
     * Defines the layout for this container
     *
     * @param layout object
     */
    setLayout(layout: TLayout): void;
}

export interface FormItemLayout {
    horizontal?: boolean;
    componentWidth?: number | string;
    componentHeight?: number | string;
    titleFontSize?: number | string;
    info?: string;
}

export interface FormContainer extends Container<FormLayout, FormItemLayout> {
}

export interface FormLayout {
    width?: number | string;
    height?: number | string;
    padding?: string;
}

export interface FormComponent<T extends Component = Component> {
    component: T;
    title?: string;
    actions?: Component[];
    required?: boolean;
}

/**
 * Used to create a group of components in a form layout
 */
    export interface FormComponentGroup {
    /**
     * The form components to display in the group along with optional layouts for each item
     */
    components: (FormComponent & { layout?: FormItemLayout })[];

    /**
     * The title of the group, displayed above its components
     */
    title: string;
}

export interface FormBuilder extends ContainerBuilder<FormContainer, FormLayout, FormItemLayout, ComponentProperties> {
    withFormItems(components: (FormComponent | FormComponentGroup)[], itemLayout?: FormItemLayout): FormBuilder;

    /**
     * Creates a collection of child components and adds them all to this container
     *
     * @param formComponents the definitions
     * @param [itemLayout] Optional layout for the child items
     */
    addFormItems(formComponents: Array<FormComponent | FormComponentGroup>, itemLayout?: FormItemLayout): void;

    /**
     * Creates a child component and adds it to this container.
     *
     * @param formComponent the component to be added
     * @param [itemLayout] Optional layout for this child item
     */
    addFormItem(formComponent: FormComponent | FormComponentGroup, itemLayout?: FormItemLayout): void;

    /**
     * Inserts a from component in a given position in the form. Returns error given invalid index
     * @param formComponent Form component
     * @param index index to insert the component to
     * @param itemLayout Item Layout
     */
    insertFormItem(formComponent: FormComponent | FormComponentGroup, index?: number, itemLayout?: FormItemLayout): void;

    /**
     * Removes a from item from the from
     */
    removeFormItem(formComponent: FormComponent | FormComponentGroup): boolean;
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
    inputBox(): ComponentBuilder<InputBoxComponent, InputBoxProperties>;
    // checkBox(): ComponentBuilder<CheckBoxComponent, CheckBoxProperties>;
    // radioButton(): ComponentBuilder<RadioButtonComponent, RadioButtonProperties>;
    // webView(): ComponentBuilder<WebViewComponent, WebViewProperties>;
    // editor(): ComponentBuilder<EditorComponent, EditorProperties>;
    // diffeditor(): ComponentBuilder<DiffEditorComponent, DiffEditorComponent>;
    text(): ComponentBuilder<TextComponent, TextComponentProperties>;
    // image(): ComponentBuilder<ImageComponent, ImageComponentProperties>;
    button(): ComponentBuilder<ButtonComponent, ButtonProperties>;
    dropDown(): ComponentBuilder<DropDownComponent, DropDownProperties>;
    // tree<T>(): ComponentBuilder<TreeComponent<T>, TreeProperties>;
    // listBox(): ComponentBuilder<ListBoxComponent, ListBoxProperties>;
    // table(): ComponentBuilder<TableComponent, TableComponentProperties>;
    // declarativeTable(): ComponentBuilder<DeclarativeTableComponent, DeclarativeTableProperties>;
    // dashboardWidget(widgetId: string): ComponentBuilder<DashboardWidgetComponent, ComponentProperties>;
    // dashboardWebview(webviewId: string): ComponentBuilder<DashboardWebviewComponent, ComponentProperties>;
    formContainer(): FormBuilder;
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

export interface TextComponent extends Component, TextComponentProperties {
}
export interface TextComponentProperties extends ComponentProperties, TitledComponentProperties {
    value?: string;
    links?: LinkArea[];
    description?: string;
    requiredIndicator?: boolean;
}

export interface LinkArea {
    text: string;
    url: string;
}

export interface TitledComponentProperties extends ComponentProperties {
    /**
     * The title for the component. This title will show when hovered over
     */
    title?: string;
}

export interface InputBoxComponent extends Component, InputBoxProperties {
    onTextChanged: vscode.Event<any>;
    /**
     * Event that's fired whenever enter is pressed within the input box
     */
    onEnterKeyPressed: vscode.Event<string>;
}

export interface InputBoxProperties extends ComponentProperties {

    getValue(): string;

    value?: string;
    ariaLive?: string;
    placeHolder?: string;
    inputType?: InputBoxInputType;
    required?: boolean;
    multiline?: boolean;
    rows?: number;
    columns?: number;
    /**
     * The minimum value allowed for the input. Only valid for number inputs.
     */
    min?: number;
    /**
     * The maximum value allowed for the input. Only valid for number inputs.
     */
    max?: number;
    /**
     * Whether to stop key event propagation when enter is pressed in the input box. Leaving this as false
     * means the event will propagate up to any parents that have handlers (such as validate on Dialogs)
     */
    stopEnterPropagation?: boolean;
    /**
     * The error message to show when custom validation fails. Note that built-in validations
     * (such as min/max values) will use the default error messages for those validations
     * as appropriate.
     */
    validationErrorMessage?: string;
    /**
     * Whether the input box is marked with the 'readonly' attribute
     */
    readOnly?: boolean;
    /**
     * This title will show when hovered over
     */
    title?: string;
}

export type InputBoxInputType = 'color' | 'date' | 'datetime-local' | 'email' | 'month' | 'number' | 'password' | 'range' | 'search' | 'text' | 'time' | 'url' | 'week';


export interface DropDownComponent extends Component, DropDownProperties {
    onValueChanged: vscode.Event<any>;
}
export interface DropDownProperties extends LoadingComponentProperties {
    value?: string | CategoryValue;
    values?: string[] | CategoryValue[];
    editable?: boolean;
    fireOnTextChange?: boolean;
    required?: boolean;
}
export interface LoadingComponentProperties extends ComponentProperties {
    /**
     * Whether to show the loading spinner instead of the contained component. True by default
     */
    loading?: boolean;
    /**
     * Whether to show the loading text next to the spinner
     */
    showText?: boolean;
    /**
     * The text to display while loading is set to true
     */
    loadingText?: string;
    /**
     * The text to display while loading is set to false. Will also be announced through screen readers
     * once loading is completed.
     */
    loadingCompletedText?: string;
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
export interface CategoryValue {
    displayName: string;
    name: string;
}
export interface IComponentEventArgs {
	eventType: ComponentEventType;
	args: any;
}

export enum ModelComponentTypes {
	NavContainer,
	DivContainer,
	FlexContainer,
	SplitViewContainer,
	Card,
	InputBox,
	DropDown,
	DeclarativeTable,
	ListBox,
	Button,
	CheckBox,
	RadioButton,
	WebView,
	Text,
	Table,
	DashboardWidget,
	DashboardWebview,
	Form,
	Group,
	Toolbar,
	LoadingComponent,
	TreeComponent,
	FileBrowserTree,
	Editor,
	DiffEditor,
	Hyperlink,
	Image,
	RadioCardGroup,
	ListView,
	TabbedPanel,
	Separator,
	PropertiesContainer,
	InfoBox,
	Slider
}

function readFile(filePath: string): Promise<Buffer> {
    return promisify(fsreadFile)(filePath);
}

function createMessageProtocol(webview: vscode.Webview): IMessageProtocol {
    return {
        sendMessage: message => webview.postMessage(message),
        onMessage: message => webview.onDidReceiveMessage(message)
    };
}

class DialogService implements vscode.Disposable {
    private _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private _serverProxy: IServerProxy;
    public proxy: IWebviewProxy;

    constructor(private _context: vscode.ExtensionContext) {}

    public async openDialog(dialog: azdata.window.Dialog): Promise<void> {
        let uri: string = 'dialog://' + generateGuid();
        this._disposables.push(this._panel = vscode.window.createWebviewPanel(uri, dialog.title,
            {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true
            },
            {
                retainContextWhenHidden: true,
                enableScripts: true
            }
        ));
        this._panel.onDidDispose(() => {
            this.dispose();
        });

        let modelView: ModelViewImpl = undefined;
        this._serverProxy = {
            getConfig: () => undefined,
            showError: (message: string) => undefined,
            showWarning: (message: string) => {
                vscode.window.showInformationMessage(message);
            },
            sendReadyEvent: async () =>  {
                this.proxy.sendEvent('start', 'message from extension');
                return true;
            },
            sendButtonClickEvent: (controlId: string) => {
                if (modelView && modelView.modelBuilder) {
                    let rootComponent = modelView.rootComponent;
                    let buttonComponent: ButtonImpl = undefined;
                    let components = [ rootComponent ];
                    while (components.length > 0) {
                        let currentComponent = components.pop();
                        if (currentComponent.id === controlId) {
                            buttonComponent = currentComponent as ButtonImpl;
                            if (buttonComponent) {
                                buttonComponent.fireOnDidClick();
                            }
                            break;
                        } else if (currentComponent.itemConfigs) {
                            currentComponent.itemConfigs.forEach(item => components.push(item.component as ComponentImpl));
                        }
                    }
                }
            },
            sendControlProperyValue: (controlId: string, propertyName: string, propertyValue: string) => {
                if (modelView && modelView.modelBuilder) {
                    let rootComponent = modelView.rootComponent;
                    let components = [ rootComponent ];
                    while (components.length > 0) {
                        let currentComponent = components.pop();
                        if (currentComponent.id === controlId) {
                            let anyComponent: any = <any>currentComponent;
                            anyComponent[propertyName] = propertyValue;
                            break;
                        } else if (currentComponent.itemConfigs) {
                            currentComponent.itemConfigs.forEach(item => components.push(item.component as ComponentImpl));
                        }
                    }
                }


            },
            dispose: () => undefined

        };
        this.proxy = createProxy(createMessageProtocol(this._panel.webview), this._serverProxy, false);

        const outputPath = path.resolve(__dirname);
        const fileContent = await readFile(path.join(outputPath, 'dialogOutput.ejs'));
        const htmlViewPath = ['out', 'src'];
        const baseUri = `${this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(this._context.extensionPath, ...htmlViewPath)))}/`;
        const formattedHTML = ejs.render(fileContent.toString(), { basehref: baseUri, prod: false });
        this._panel.webview.html = formattedHTML;

        let dialogImpl: DialogImpl = dialog as DialogImpl;
        if (dialogImpl) {
            modelView = new ModelViewImpl(this.proxy);
            dialogImpl.contentHandler(modelView);
        }
    }

    public closeDialog(dialog: azdata.window.Dialog): void {
        vscode.window.showInformationMessage('close dialog');
    }

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }
}

export type ThemedIconPath = { light: string | vscode.Uri; dark: string | vscode.Uri };
export type IconPath = string | vscode.Uri | ThemedIconPath;

export namespace window {
    /**
     * The width of a dialog, either from a predetermined size list or a specific size (such as px)
     */
    export type DialogWidth = 'narrow' | 'medium' | 'wide' | number | string;

    /**
     * Create a dialog with the given title
     * @param title Title of the dialog, displayed at the top.
     * @param dialogName Name of the dialog.
     * @param width Width of the dialog, default is 'narrow'.
     */
    export function createModelViewDialog(title: string, dialogName?: string, width?: DialogWidth): Dialog {
        let dialog: DialogImpl = new DialogImpl();
        dialog.title = title;
        dialog.dialogName = dialogName;
        return dialog;
    }

    /**
     * Opens the given dialog if it is not already open
     */
    export function openDialog(dialog: Dialog): void {
        dialogService.openDialog(dialog);
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


}
