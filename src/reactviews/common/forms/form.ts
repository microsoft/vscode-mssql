/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Theme } from "@fluentui/react-components";

export interface FormState<T> {
	formState: T;
}

export interface FormContextProps<TState extends FormState<TForm>, TForm> {
	state: TState;
	theme: Theme;
	formAction: (event: FormEvent<TForm>) => void;
}

/**
 * Describes a field in a connection dialog form.
 */
export interface FormItemSpec<TForm> {
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
	 * Validation callback for the form item
	 */
	validate?: (value: string | boolean | number) => FormItemValidationState;
	/**
	 * Validation state and message for the form item
	 */
	validation?: FormItemValidationState;
}

export interface FormItemValidationState {
	/**
	 * The validation state of the form item
	 */
	isValid: boolean
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
}

/**
 * Enum for the input type of form item
 */
export enum FormItemType {
	Input = 'input',
	Dropdown = 'dropdown',
	Checkbox = 'checkbox',
	Password = 'password',
	Button = 'button',
	TextArea = 'textarea'
}