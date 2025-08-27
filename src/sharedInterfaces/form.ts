/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewContextProps } from "./webview";

export interface FormState<
    TForm,
    TState extends FormState<TForm, TState, TFormItemSpec>,
    TFormItemSpec extends FormItemSpec<TForm, TState, TFormItemSpec>,
> {
    formState: TForm;
    formComponents: Partial<Record<keyof TForm, TFormItemSpec>>;
}

export interface FormContextProps<
    TForm,
    TState extends FormState<TForm, TState, TFormItemSpec>,
    TFormItemSpec extends FormItemSpec<TForm, TState, TFormItemSpec>,
> extends WebviewContextProps<TState> {
    formAction: (event: FormEvent<TForm>) => void;
}

export interface FormReducers<TForm> {
    formAction: {
        event: FormEvent<TForm>;
    };
}

/**
 * Describes a field in a connection dialog form.
 */
export interface FormItemSpec<
    TForm,
    TState extends FormState<TForm, TState, TFormItemSpec>,
    TFormItemSpec extends FormItemSpec<TForm, TState, TFormItemSpec>,
> {
    /**
     * The type of the form item
     */
    type: FormItemType;
    /**
     * The property name of the form item
     */
    propertyName: keyof TForm;
    /**
     * The label of the form item
     */
    label: string;
    /**
     * Whether the form item is required
     */
    required: boolean;
    /**
     * The tooltip of the form item
     */
    tooltip?: string;
    /**
     * The options for the form item in case of a dropdown
     */
    options?: FormItemOptions[];
    /**
     * Whether the form item is hidden
     */
    hidden?: boolean;
    /**
     *	Action buttons for the form item
     */
    actionButtons?: FormItemActionButton[];
    /**
     * Placeholder text for the form item
     */
    placeholder?: string;
    /**
     * Placeholder text for the search box in a searchable dropdown
     */
    searchBoxPlaceholder?: string;
    /**
     * Validation callback for the form item
     */
    validate?: (state: TState, value: string | boolean | number) => FormItemValidationState;
    /**
     * Validation state and message for the form item
     */
    validation?: FormItemValidationState;
}

export interface FormItemValidationState {
    /**
     * The validation state of the form item
     */
    isValid: boolean;
    /**
     * The validation message of the form item
     */
    validationMessage: string;
}

export interface FormItemActionButton {
    label: string;
    id: string;
    hidden?: boolean;
    callback: () => void;
}

export interface FormItemOptions {
    displayName: string;
    value: string;
    /**
     * Option description
     */
    description?: string;
    /**
     * Option Icon
     */
    icon?: string;
    /**
     * Optional styling for the option
     */
    style?: any;
}

/**
 * Interface for a form event
 */
export interface FormEvent<T> {
    /**
     * The property name of the form item that triggered the event
     */
    propertyName: keyof T;
    /**
     * Whether the event was triggered by an action button for the item
     */
    isAction: boolean;
    /**
     * Contains the updated value of the form item that triggered the event.
     * In case of isAction being true, this will contain the id of the action button that was clicked
     */
    value: string | boolean;

    /**
     * Whether to update the validation state of the form item
     */
    updateValidation?: boolean;
}

/**
 * Enum for the input type of form item
 */
export enum FormItemType {
    Input = "input",
    Dropdown = "dropdown",
    Checkbox = "checkbox",
    Password = "password",
    Button = "button",
    TextArea = "textarea",
    SearchableDropdown = "searchableDropdown",
}
