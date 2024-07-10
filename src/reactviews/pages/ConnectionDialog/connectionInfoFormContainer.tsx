/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ConnectionDialogContext, FormTabs } from "./connectionDialogStateProvider";
import { Button, Checkbox, Dropdown, Field, Input, Option, Tab, TabList, makeStyles } from "@fluentui/react-components";
import { EyeRegular, EyeOffRegular } from "@fluentui/react-icons";
import * as vscodeMssql from 'vscode-mssql';

const useStyles = makeStyles({
	formDiv: {
		padding: '10px',
		maxWidth: '500px',
		display: 'flex',
		flexDirection: 'column',
		'> *': {
			margin: '5px',
		}
	}
});

export const ConnectionInfoFormContainer = () => {
	const state = useContext(ConnectionDialogContext);
	const classes = useStyles();
	const [showPassword, setShowPassword] = useState<Record<number, boolean>>({});
	const [components, setComponents] = useState<vscodeMssql.ConnectionDialog.FormComponent[]>([]);
	const generateComponent = () => {
		setComponents([
			{
				label: 'Server',
				type: 'input',
				value: state?.state?.formConnection?.server ? state.state.formConnection.server : '',
				onChange: (value) => {
					state.state.formConnection!.server = value as string;
					state.updateConnection(state.state.formConnection!);
				}
			}, {
				label: 'Authentication Type',
				type: 'dropdown',
				options: [
					{
						name: 'SQL Login',
						value: 'SqlLogin'
					},
					{
						name: 'Windows Authentication',
						value: 'Integrated'
					},
					{
						name: 'Microsoft Entra ID - Universal with MFA support',
						value: 'AzureMFA'
					}
				],

				value: state?.state?.formConnection?.authenticationType ? state.state.formConnection.authenticationType : '',
				onChange: (value) => {
					state.updateConnection({ ...state.state.formConnection, authenticationType: value as string });
				}
			}, {
				label: 'Username',
				type: 'input',
				value: state?.state?.formConnection?.user ? state.state.formConnection.user : '',
				onChange: (value) => {
					state.updateConnection({ ...state.state.formConnection, user: value as string });
				},
				hidden: state?.state?.formConnection?.authenticationType !== 'SqlLogin'

			}, {
				label: 'Password',
				type: 'password',
				value: state?.state?.formConnection?.password ? state.state.formConnection.password : '',
				onChange: (value) => {
					state.updateConnection({ ...state.state.formConnection, password: value as string });
				},
				hidden: state?.state?.formConnection?.authenticationType !== 'SqlLogin'

			}, {
				label: 'Remember Password',
				type: 'checkbox',
				value: state?.state?.formConnection?.persistSecurityInfo ? state.state.formConnection.persistSecurityInfo : false,
				onChange: (_value) => {
					// state.updateConnection({ ...state.state.formConnection, persistSecurityInfo: value as boolean });
				},
				hidden: state?.state?.formConnection?.authenticationType !== 'SqlLogin'
			}, {
				label: 'Azure Account',
				type: 'dropdown',
				value: state?.state?.formConnection?.accountId ? state.state.formConnection.accountId : '',
				options: state?.state?.accounts?.map(account => {
					return {
						name: account.displayName,
						value: account.id
					};
				}),
				onChange: (_value) => {
					// state.updateConnection({ ...state.state.formConnection, accountId: value as string });
				},
				// If there are no accounts show add account button and if the selected account is stale show refresh button
				actionButtons: state?.state?.accounts?.length === 0 ? [
					{
						label: 'Add Account',
						onClick: () => {
							//state.addAccount();
						}
					}
				] : state?.state?.accounts?.find(v => v.id === state?.state.formConnection?.accountId)?.isState ? [
					{
						label: 'Refresh Account',
						onClick: () => {
							//state.refreshAccount(state.state.formConnection.accountId);
						}
					}
				] : [],
				hidden: state?.state?.formConnection?.authenticationType !== 'AzureMFA'

			}, {
				label: 'Database',
				type: 'input',
				value: state?.state?.formConnection ? state.state.formConnection.database : '',
				onChange: (_value) => {
				}
			}, {
				label: 'Encrypt Connection',
				type: 'dropdown',
				options: [
					{
						name: 'Optional',
						value: 'optional'
					},
					{
						name: 'Mandatory',
						value: 'mandatory'
					},
					{
						name: 'Strict (Suppoted for SQL Server 2022 and Azure SQL)',
						value: 'strict'
					}
				],
				value: state?.state?.formConnection?.encrypt ? state.state.formConnection.encrypt : '',
				onChange: (_value) => {
				}
			}, {
				label: 'Trust Server Certificate',
				type: 'checkbox',
				value: state?.state?.formConnection?.trustServerCertificate ? state.state.formConnection.trustServerCertificate : false,
				onChange: (_value) => {
				}
			}
		]);
	};
	useEffect(() => {
		generateComponent();
	}, [state?.state?.formConnection]);

	const getShowPasswordForComponent = (idx: number) => {
		if (!showPassword[idx]) {
			showPassword[idx] = false;
		}
		return showPassword[idx];
	};
	const setShowPasswordForComponent = (idx: number, value: boolean) => {
		showPassword[idx] = value;
		setShowPassword({ ...showPassword });
	};

	if (!state?.state) {
		return undefined;
	}



	function renderComponent(component: vscodeMssql.ConnectionDialog.FormComponent, index: number) {
		switch (component.type) {
			case 'input':
				return (
					<Input
						size="small"
						value={component.value as string}
						onChange={(_value, data) => component.onChange(data.value)}
					/>
				);
			case 'dropdown':
				return (
					<Dropdown>
						{
							component.options?.map(option => {
								return (
									<Option key={option.value} value={option.value}>
										{option.name}
									</Option>
								);
							})
						}
					</Dropdown>
				);
			case 'password':
				return (
					<Input
						size="small"
						type={getShowPasswordForComponent(index) ? 'text' : 'password'}
						value={component.value as string}
						onChange={(_value, data) => component.onChange(data.value)}
						contentAfter={
							<Button
								onClick={() => setShowPasswordForComponent(index, !getShowPasswordForComponent(index))}
								icon={getShowPasswordForComponent(index) ? <EyeRegular /> : <EyeOffRegular />}
								size="small"
								appearance="transparent"
							>
							</Button>}
					/>
				);
			case 'checkbox':
				return (
					<Checkbox
						type="checkbox"
						checked={component.value as boolean}
						onChange={(_value, data) => component.onChange(data.checked)}
					/>
				);
		}
	}

	return (
		<div>
			<TabList selectedValue={state?.state?.selectedFormTab ?? FormTabs.Parameters} onTabSelect={(_event, data) => {
				state?.setFormTab(data.value as FormTabs);
			}}>
				<Tab value={FormTabs.Parameters}>Parameters</Tab>
				<Tab value={FormTabs.ConnectionString}>Connection String</Tab>
			</TabList>
			<div>
				{
					state?.state?.selectedFormTab === FormTabs.Parameters &&
					<div className={classes.formDiv}>
						{
							components.map((component, index) => {
								console.log('component', component);
								if (component.hidden) {
									return undefined;
								} else {
									return <Field size='small' orientation='horizontal' label={component.label} key={index}>
										{
											renderComponent(component, index)
										}
									</Field>;
								}
							})
						}
					</div>
				}
				{
					state?.state?.selectedFormTab === FormTabs.ConnectionString &&
					<div className={classes.formDiv}>
						Under Construction
					</div>
				}
			</div>
		</div>
	)
}