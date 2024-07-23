/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { Text, Button, Checkbox, Dropdown, Field, Input, Option, Tab, TabList, makeStyles, Image, MessageBar, Textarea, webLightTheme, Spinner } from "@fluentui/react-components";
import { ApiStatus, FormComponent, FormComponentType, FormTabs, IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { EyeRegular, EyeOffRegular } from "@fluentui/react-icons";
import './sqlServerRotation.css';
import { VscodeWebviewContext } from "../../common/vscodeWebViewProvider";
const sqlServerImage = require('../../../../media/sqlServer.svg');
const sqlServerImageDark = require('../../../../media/sqlServer_inverse.svg');

const useStyles = makeStyles({
	formRoot: {
		display: 'flex',
		flexDirection: 'column',
		height: '100%',
	},
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

const FormInput = ({ value, target, type }: { value: string, target: keyof IConnectionDialogProfile, type: 'input' | 'password' | 'textarea' }) => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const [inputVal, setValueVal] = useState(value);
	const [showPassword, setShowPassword] = useState(false);

	useEffect(() => {
		console.log('value changed');
		setValueVal(value);
	}, [value]);

	const handleChange = (data: string) => {
		setValueVal(data);
	};

	const handleBlur = () => {
		connectionDialogContext?.formAction({
			propertyName: target,
			isAction: false,
			value: inputVal
		});
	};

	return (
		<>
			{
				type === 'input' &&
				<Input
					value={inputVal}
					onChange={(_value, data) => handleChange(data.value)}
					onBlur={handleBlur}
					size="small"
				/>
			}
			{
				type === 'password' &&
				<Input
					type={showPassword ? 'text' : 'password'}
					value={inputVal}
					onChange={(_value, data) => handleChange(data.value)}
					onBlur={handleBlur}
					size="small"
					contentAfter={
						<Button
							onClick={() => setShowPassword(!showPassword)}
							icon={showPassword ? <EyeRegular /> : <EyeOffRegular />}
							appearance="transparent"
							size="small"
						>
						</Button>}
				/>
			}
			{
				type === 'textarea' &&
				<Textarea
				    value={inputVal}
					size="small"
					onChange={(_value, data) => handleChange(data.value)}
					onBlur={handleBlur}
				/>
			}
		</>
	);
};

export const ConnectionInfoFormContainer = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const classes = useStyles();
	const vscode = useContext(VscodeWebviewContext);

	const generateFormComponent = (component: FormComponent, profile: IConnectionDialogProfile, _idx: number) => {
		switch (component.type) {
			case FormComponentType.Input:
				return <FormInput value={profile[component.propertyName] as string ?? ''} target={component.propertyName} type='input' />;
			case FormComponentType.TextArea:
				return <FormInput value={profile[component.propertyName] as string ?? ''} target={component.propertyName} type='textarea' />;
			case FormComponentType.Password:
				return <FormInput value={profile[component.propertyName] as string ?? ''} target={component.propertyName} type='password' />;
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
		<div className={classes.formRoot}>
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
					src={vscode?.theme === webLightTheme ? sqlServerImage : sqlServerImageDark} alt='SQL Server' height={60} width={60} />
				<Text size={500} style={
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
			<div style={
				{
					overflow: 'auto'
				}
			}>
				<div className={classes.formDiv}>
					{
						connectionDialogContext?.state.formError &&
						<MessageBar intent="error">
							{connectionDialogContext.state.formError}
						</MessageBar>
					}

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
												return <Button shape="square" key={idx + actionButton.id} appearance='outline' style={
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
					<Button
						appearance="primary"
						disabled={connectionDialogContext.state.connectionStatus === ApiStatus.Loading}
						shape="square"
						onClick={(_event) => {
							connectionDialogContext.connect();
						}} style={
							{
								width: '200px',
								alignSelf: 'center'
							}
						}
						iconPosition="after"
					    icon={ connectionDialogContext.state.connectionStatus === ApiStatus.Loading ? <Spinner size='tiny' /> : undefined}>
							Connect
						</Button>
				</div>
			</div>
		</div>
	)
}