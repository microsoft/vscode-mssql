/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Theme } from "@fluentui/react-components";
import * as vscodeMssql from "vscode-mssql";
import { FormItemSpec, FormContextProps, FormEvent, FormState } from "../reactviews/common/forms/form";
import { ApiStatus } from "./webview";

export class ConnectionDialogWebviewState implements FormState<IConnectionDialogProfile> {
    /** the underlying connection profile for the form target; same as `connectionProfile` */
    formState: IConnectionDialogProfile;
    /** The underlying connection profile for the form target; a more intuitively-named alias for `formState` */
    get connectionProfile(): IConnectionDialogProfile { return this.formState; }
    set connectionProfile(value: IConnectionDialogProfile) { this.formState = value; }
    public selectedFormTab: FormTabType;
    public connectionFormComponents: {
        mainComponents: FormItemSpec<IConnectionDialogProfile>[],
        advancedComponents: { [category: string]: FormItemSpec<IConnectionDialogProfile>[] }
    };
    public connectionStringComponents: FormItemSpec<IConnectionDialogProfile>[];
    public recentConnections: IConnectionDialogProfile[];
    public connectionStatus: ApiStatus;
    public formError: string;

    constructor({
        connectionProfile,
        selectedFormTab,
        connectionFormComponents,
        connectionStringComponents,
        recentConnections,
        connectionStatus,
        formError
    }: {
        connectionProfile: IConnectionDialogProfile,
        selectedFormTab: FormTabType,
        connectionFormComponents: {
            mainComponents: FormItemSpec<IConnectionDialogProfile>[],
            advancedComponents: { [category: string]: FormItemSpec<IConnectionDialogProfile>[] }
        },
        connectionStringComponents: FormItemSpec<IConnectionDialogProfile>[],
        recentConnections: IConnectionDialogProfile[],
        connectionStatus: ApiStatus,
        formError: string
    }) {
        this.formState = connectionProfile;
        this.selectedFormTab = selectedFormTab;
        this.connectionFormComponents = connectionFormComponents;
        this.connectionStringComponents = connectionStringComponents;
        this.recentConnections = recentConnections;
        this.connectionStatus = connectionStatus;
        this.formError = formError;
    }
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