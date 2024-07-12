import * as vscodeMssql from "vscode-mssql";

export enum FormTabs {
	Parameters = 'parameter',
	ConnectionString = 'connString'
}

// A Connection Profile contains all the properties of connection credentials, with additional
// optional name and details on whether password should be saved
export interface IConnectionDialogProfile extends vscodeMssql.IConnectionInfo {
	profileName?: string;
	savePassword?: boolean;
	emptyPasswordInput?: boolean;
	azureAuthType?: vscodeMssql.AzureAuthType;
}

export interface ConnectionDialogWebviewState {
	selectedFormTab: FormTabs;
	recentConnections: IConnectionDialogProfile[];
	formComponents: FormComponent[];
	connectionProfile: IConnectionDialogProfile;
}

export interface ConnectionDialogContextProps {
	state: ConnectionDialogWebviewState;
	loadConnection: (connection: IConnectionDialogProfile) => void;
	formAction: (event: FormEvent) => void;
	setFormTab: (tab: FormTabs) => void;
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
	 * The tooltip of the form component
	 */
	tooltip?: string;
	/**
	 * The options for the form component in case of a dropdown
	 */
	options?: FormComponentOptions[];
	/**
	 * The validation message for the form component
	 */
	validationMessage?: string;
	/**
	 * The validation state for the form component
	 */
	validationState?: ComponentValidationState;
	/**
	 * Whether the form component is hidden
	 */
	hidden?: boolean;
	/**
	 *	Action buttons for the form component
	 */
	actionButtons?: {
		label: string;
		id: string;
		hidden?: boolean;
	}
}

export interface FormComponentOptions {
	displayName: string;
	value: string;
}

/**
 * Interface for a form event
 */
export interface FormEvent {
	/**
	 * The property name of the form component that triggered the event
	 */
	propertyName: string;
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
	Button = 'button'
}

/**
 * Enum for the validation state of a component
 */
export enum ComponentValidationState {
	None = 'none',
	Error = 'error',
	Warning = 'warning',
	Success = 'success'
}

export enum AuthenticationType {
	SqlLogin = 'SqlLogin',
	Integrated = 'Integrated',
	AzureMFA = 'AzureMFA'
}