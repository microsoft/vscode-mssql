/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Theme } from "@fluentui/react-components";
import * as vscodeMssql from "vscode-mssql";
import { FormItemSpec, FormContextProps, FormEvent, FormState } from "../reactviews/common/forms/form";
import { ApiStatus } from "./webview";

export interface ConnectionDialogWebviewState extends FormState<IConnectionDialogProfile> {
	selectedFormTab: FormTabType;
	connectionFormComponents: {
		mainComponents: FormItemSpec<IConnectionDialogProfile>[];
		advancedComponents: {[category: string]: FormItemSpec<IConnectionDialogProfile>[]};
	};
	connectionStringComponents: FormItemSpec<IConnectionDialogProfile>[];
	formState: IConnectionDialogProfile;
	recentConnections: IConnectionDialogProfile[];
	connectionStatus: ApiStatus;
	formError: string;
}

export enum FormTabType {
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



export interface ConnectionDialogContextProps extends FormContextProps<ConnectionDialogWebviewState, IConnectionDialogProfile> {
	theme: Theme;
	loadConnection: (connection: IConnectionDialogProfile) => void;
	setFormTab: (tab: FormTabType) => void;
	connect: () => void;
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