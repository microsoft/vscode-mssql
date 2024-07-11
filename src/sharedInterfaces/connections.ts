import * as vscodeMssql from "vscode-mssql";

enum FormTabs {
	Parameters = 'parameter',
	ConnectionString = 'connString'
}
export interface ConnectionInfo extends vscodeMssql.IConnectionInfo {
	profileName?: string;
}
export interface ConnectionDialogWebviewState {
	selectedFormTab: FormTabs;
	recentConnections: ConnectionInfo[];
	formConnection: ConnectionInfo;
	accounts: {
		id: string;
		displayName: string;
		isState: boolean
	}[];
}
export interface ConnectionDialogContextProps {
	state: ConnectionDialogWebviewState;
	updateConnection: (connection: ConnectionInfo) => void;
	setFormTab: (tab: FormTabs) => void;
}
export interface FormComponent {
	type: 'input' | 'dropdown' | 'checkbox' | 'password';
	label: string;
	tooltip?: string | undefined;
	value: string | boolean;
	options?: {
		name: string;
		value: string;
	}[];
	onChange: (value: string | boolean) => void;
	actionButtons?: {
		label: string;
		onClick: () => void;
		icon?: any;
	}[]
	validationMessage?: string;
	validationState?: 'error' | 'warning' | 'none' | 'success';
	hidden?: boolean;
}