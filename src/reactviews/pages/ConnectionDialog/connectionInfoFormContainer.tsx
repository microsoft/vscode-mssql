/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { Text, Button, Checkbox, Dropdown, Field, Input, Option, Tab, TabList, makeStyles, Image, MessageBar, Textarea } from "@fluentui/react-components";
import { ApiStatus, FormComponent, FormComponentType, FormTabs, IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { EyeRegular, EyeOffRegular, DatabasePlugConnectedRegular } from "@fluentui/react-icons";
import './sqlServerRotation.css';
const sqlServerImage = require('../../../../media/sqlServer.svg');

const useStyles = makeStyles({
	formDiv: {
		padding: '10px',
		maxWidth: '500px',
		display: 'flex',
		flexDirection: 'column',
		'> *': {
			margin: '5px',
		}
	},
	formComponentDiv: {
		'> *': {
			margin: '5px',
		}
	},
	formComponentActionDiv: {
		display: 'flex',
		flexDirection: 'row',
		'> *': {
			margin: '5px',
		}
	}
});

export const ConnectionInfoFormContainer = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const classes = useStyles();
	const [showPassword, setShowPassword] = useState<Record<number, boolean>>({});


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

	const generateFormComponent = (component: FormComponent, profile: IConnectionDialogProfile, idx: number) => {
		switch (component.type) {
			case FormComponentType.Input:
				return <Input autoFocus={idx === 0}
					size="small"
					value={(profile[component.propertyName] as string) ?? ''}
					onChange={(_value, data) => connectionDialogContext?.formAction({
						propertyName: component.propertyName,
						isAction: false,
						value: data.value
					})}
				/>
			case FormComponentType.TextArea:
				return <Textarea
					size="small"
					value={(profile[component.propertyName] as string) ?? ''}
					onChange={(_value, data) => connectionDialogContext?.formAction({
						propertyName: component.propertyName,
						isAction: false,
						value: data.value
					})}
				/>
			case FormComponentType.Password:
				return <Input
					size="small"
					type={getShowPasswordForComponent(idx) ? 'text' : 'password'}
					value={profile[component.propertyName] as string ?? ''}
					onChange={(_value, data) => connectionDialogContext?.formAction({
						propertyName: component.propertyName,
						isAction: false,
						value: data.value
					})}
					contentAfter={
						<Button
							onClick={() => setShowPasswordForComponent(idx, !getShowPasswordForComponent(idx))}
							icon={getShowPasswordForComponent(idx) ? <EyeRegular /> : <EyeOffRegular />}
							size="small"
							appearance="transparent"
						>
						</Button>}
				/>
			case FormComponentType.Dropdown:
				if (component.options === undefined) {
					throw new Error('Dropdown component must have options');
				}
				return <Dropdown
					size="small"
					placeholder={component.placeholder ?? ''}
					value={component.options.find(option => option.value === profile[component.propertyName])?.displayName ?? ''}
					selectedOptions={[profile[component.propertyName] as string]}
					onOptionSelect={(_event, data) => {
						connectionDialogContext?.formAction({
							propertyName: component.propertyName,
							isAction: false,
							value: data.optionValue as string
						});
					}}>
					{
						component.options?.map((option, idx) => {
							return <Option key={component.propertyName + idx} value={option.value}>{option.displayName}</Option>
						})
					}
				</Dropdown>;
			case FormComponentType.Checkbox:
				return <Checkbox
					size="medium"
					checked={profile[component.propertyName] as boolean ?? false}
					onChange={(_value, data) => connectionDialogContext?.formAction({
						propertyName: component.propertyName,
						isAction: false,
						value: data.checked
					})}
				/>;

		}
	};

	if (!connectionDialogContext?.state) {
		return undefined;
	}

	return (
		<div>
			<div style={
				{
					display: 'flex',
					flexDirection: 'row',
					alignItems: 'center'
				}
			}>
				<Image style={
					{
						padding: '10px',
					}
				}
					src={sqlServerImage} alt='SQL Server' height={60} width={60} />
				<Text size={600} style={
					{
						lineHeight: '60px'
					}
				} weight='medium'>Connect to SQL Server</Text>
			</div>
			<TabList selectedValue={connectionDialogContext?.state?.selectedFormTab ?? FormTabs.Parameters} onTabSelect={(_event, data) => {
				connectionDialogContext?.setFormTab(data.value as FormTabs);
			}}>
				<Tab value={FormTabs.Parameters}>Parameters</Tab>
				<Tab value={FormTabs.ConnectionString}>Connection String</Tab>
			</TabList>
			{
				connectionDialogContext?.state.formError &&
				<MessageBar>
					{connectionDialogContext.state.formError}
				</MessageBar>
			}

			<div>
				<div className={classes.formDiv}>
					{
						connectionDialogContext.state.formComponents.map((component, idx) => {
							if (component.hidden === true) {
								return undefined;
							}
							return <div className={classes.formComponentDiv} key={idx}>
								<Field
									validationMessage={component.validation?.validationMessage ?? ''}
									orientation={component.type === FormComponentType.Checkbox ? 'horizontal' : 'vertical'}
									validationState={component.validation ? (component.validation.isValid ? 'none' : 'error') : 'none'}
									required={component.required}
									label={component.label}>
									{generateFormComponent(component, connectionDialogContext.state.connectionProfile, idx)}
								</Field>
								{
									component?.actionButtons?.length! > 0 &&
									<div className={classes.formComponentActionDiv}>
										{
											component.actionButtons?.map((actionButton, idx) => {
												return <Button key={idx + actionButton.id} appearance='outline' style={
													{
														width: '120px'
													}
												} onClick={() => connectionDialogContext?.formAction({
													propertyName: component.propertyName,
													isAction: true,
													value: actionButton.id
												})}>{actionButton.label}</Button>
											})
										}
									</div>
								}
							</div>;
						})
					}
					<Button appearance="primary"
						disabled={connectionDialogContext.state.connectionStatus === ApiStatus.Loading} onClick={(_event) => {
							connectionDialogContext.connect();
						}} style={
							{
								width: '120px'
							}
						} icon={<DatabasePlugConnectedRegular />}>Connect</Button>
				</div>
			</div>
		</div>
	)
}