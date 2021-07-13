/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';
import * as azdata from 'azdata';

const localize = nls.loadMessageBundle();

export class ConnectionDialog {

	// Top level
	private readonly GeneralTabText: string = localize('connectionDialog.general', "General");

	// General tab strings
	private readonly ServerTextBoxLabel: string = localize('connectionDialog.server', "Server");
	private readonly AuthenticationDropdownLabel: string = localize('connectionDialog.authentication', "Authentication");
	private readonly DatabaseDropdownLabel: string = localize('connectionDialog.database', "Databases");
	private readonly ServerGroupDropdownLabel: string = localize('connectionDialog.serverGroups', "Server Groups");
	private readonly AdvancedButtonLabel: string = localize('connectionDialog.advanced', "Advanced Settings");
	private readonly NameTextBoxLabel: string = localize('connectionDialog.name', "Name");

	// UI Components
	private dialog: azdata.window.Dialog;
	private generalTab: azdata.window.DialogTab;
	private serverTextBox: azdata.InputBoxComponent;
	private nameTextBox: azdata.InputBoxComponent;
	private authenticationDropdown: azdata.DropDownComponent;
	private databaseDropdown: azdata.DropDownComponent;
	private serverGroupDropdown: azdata.DropDownComponent;
	private advancedButton: azdata.ButtonComponent;

	public constructor() {
		this.dialog = azdata.window.createModelViewDialog('Connection Dialog');
		this.generalTab = azdata.window.createTab(this.GeneralTabText);
		this.initializeGeneralTab();
		this.dialog.content = [this.generalTab];
		this.dialog.okButton.onClick(() => {
			///
		});

	}

	public open(): void {
		azdata.window.openDialog(this.dialog);
	}
	private initializeGeneralTab() {
		this.generalTab.registerContent(async view => {
			this.serverTextBox = view.modelBuilder.inputBox().component();
			this.serverTextBox.required = true;
			this.authenticationDropdown = view.modelBuilder.dropDown().component();
			this.databaseDropdown = view.modelBuilder.dropDown().component();
			this.serverGroupDropdown = view.modelBuilder.dropDown().component();
			this.nameTextBox = view.modelBuilder.inputBox().component();
			this.advancedButton = view.modelBuilder.button().component();

			let formModel = view.modelBuilder.formContainer()
				.withFormItems([{
					component: this.serverTextBox,
					title: this.ServerTextBoxLabel
				}, {
					component: this.authenticationDropdown,
					title: this.AuthenticationDropdownLabel
				}, {
					component: this.databaseDropdown,
					title: this.DatabaseDropdownLabel
				}, {
					component: this.serverGroupDropdown,
					title: this.ServerGroupDropdownLabel
				}, {
					component: this.nameTextBox,
					title: this.NameTextBoxLabel
				}, {
					component: this.advancedButton,
					title: this.AdvancedButtonLabel
				},
				]).component();

			await view.initializeModel(formModel);
		});

	}
}
