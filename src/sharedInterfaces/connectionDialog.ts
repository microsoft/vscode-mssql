/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Theme } from "@fluentui/react-components";
import * as vscodeMssql from "vscode-mssql";

export interface ConnectionDialogWebviewState {
	selectedFormTab: FormTabType;
	formTabs: FormTab[];
	recentConnections: IConnectionDialogProfile[];
	connectionProfile: IConnectionDialogProfile;
	connectionStatus: ApiStatus;
	formError: string;
}

export enum FormTabType {
	Parameters = 'parameter',
	ConnectionString = 'connString'
}

export interface FormTab {
	tab: FormTabType;
	components: FormComponent[];
}

// A Connection Profile contains all the properties of connection credentials, with additional
// optional name and details on whether password should be saved
export interface IConnectionDialogProfile extends vscodeMssql.IConnectionInfo {
	profileName?: string;
	savePassword?: boolean;
	emptyPasswordInput?: boolean;
	azureAuthType?: vscodeMssql.AzureAuthType;
}

export enum ApiStatus {
	NotStarted = 'notStarted',
	Loading = 'loading',
	Loaded = 'loaded',
	Error = 'error',
}

export interface FormContextProps<T> {
	formAction: (event: FormEvent<T>) => void;
}

export interface ConnectionDialogContextProps extends FormContextProps<IConnectionDialogProfile> {
	state: ConnectionDialogWebviewState;
	theme: Theme;
	loadConnection: (connection: IConnectionDialogProfile) => void;
	setFormTab: (tab: FormTabType) => void;
	connect: () => void;
}

/**
 * Describes a field in a connection dialog form.
 */

export interface FormComponent {
	/**
	 * The type of the form component
	 */
	type: FormComponentType;
	/**
	 * The property name of the form component
	 */
	propertyName: keyof IConnectionDialogProfile;
	/**
	 * The label of the form component
	 */
	label: string;
	/**
	 * Whether the form component is required
	 */
	required: boolean;
	/**
	 * The tooltip of the form component
	 */
	tooltip?: string;
	/**
	 * The options for the form component in case of a dropdown
	 */
	options?: FormComponentOptions[];
	/**
	 * Whether the form component is hidden
	 */
	hidden?: boolean;
	/**
	 *	Action buttons for the form component
	 */
	actionButtons?: FormComponentActionButton[];
	/**
	 * Placeholder text for the form component
	 */
	placeholder?: string;
	/**
	 * Validation callback for the form component
	 */
	validate?: (value: string | boolean | number) => FormComponentValidationState;
	/**
	 * Validation state and message for the form component
	 */
	validation?: FormComponentValidationState;
}

export interface FormComponentValidationState {
	/**
	 * The validation state of the form component
	 */
	isValid: boolean
	/**
	 * The validation message of the form component
	 */
	validationMessage: string;
}

export interface FormComponentActionButton {
	label: string;
	id: string;
	hidden?: boolean;
	callback: () => void;
}

export interface FormComponentOptions {
	displayName: string;
	value: string;
}

/**
 * Interface for a form event
 */
export interface FormEvent<T> {
	/**
	 * The property name of the form component that triggered the event
	 */
	propertyName: keyof T;
	/**
	 * Whether the event was triggered by an action button for the component
	 */
	isAction: boolean;
	/**
	 * Contains the updated value of the form component that triggered the event.
	 * In case of isAction being true, this will contain the id of the action button that was clicked
	 */
	value: string | boolean;
}

/**
 * Enum for the type of form component
 */
export enum FormComponentType {
	Input = 'input',
	Dropdown = 'dropdown',
	Checkbox = 'checkbox',
	Password = 'password',
	Button = 'button',
	TextArea = 'textarea'
}

export enum AuthenticationType {
	SqlLogin = 'SqlLogin',
	Integrated = 'Integrated',
	AzureMFA = 'AzureMFA'
}

export interface ConnectionDialogReducers {
	setFormTab: {
		tab: FormTabType;
	},
	formAction: {
		event: FormEvent<IConnectionDialogProfile>;
	},
	loadConnection: {
		connection: IConnectionDialogProfile;
	},
	connect: {}
}