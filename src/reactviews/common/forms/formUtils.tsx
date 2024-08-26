/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { Input, Button, Textarea, Dropdown, Checkbox, Option, makeStyles, Field, InfoLabel, LabelProps } from "@fluentui/react-components";
import { EyeRegular, EyeOffRegular } from "@fluentui/react-icons";

import { ConnectionDialogContextProps, FormComponent, FormComponentType, IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { ConnectionDialogContext } from "../../pages/ConnectionDialog/connectionDialogStateProvider";

export const FormInput = ({ value, target, type }: { value: string, target: keyof IConnectionDialogProfile, type: 'input' | 'password' | 'textarea' }) => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const [formInputValue, setFormInputValue] = useState(value);
	const [showPassword, setShowPassword] = useState(false);

	useEffect(() => {
		setFormInputValue(value);
	}, [value]);

	const handleChange = (data: string) => {
		setFormInputValue(data);
	};

	const handleBlur = () => {
		connectionDialogContext?.formAction({
			propertyName: target,
			isAction: false,
			value: formInputValue
		});
	};

	return (
		<>
			{
				type === 'input' &&
				<Input
					value={formInputValue}
					onChange={(_value, data) => handleChange(data.value)}
					onBlur={handleBlur}
					size="small"
				/>
			}
			{
				type === 'password' &&
				<Input
					type={showPassword ? 'text' : 'password'}
					value={formInputValue}
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
				    value={formInputValue}
					size="small"
					onChange={(_value, data) => handleChange(data.value)}
					onBlur={handleBlur}
				/>
			}
		</>
	);
};

export const FormField = ({connectionDialogContext, component, idx}: { connectionDialogContext: ConnectionDialogContextProps, component: FormComponent, idx: number}) => {
	const formStyles = useFormStyles();

	return (
		<div className={formStyles.formComponentDiv} key={idx}>
			<Field
				validationMessage={component.validation?.validationMessage ?? ''}
				orientation={component.type === FormComponentType.Checkbox ? 'horizontal' : 'vertical'}
				validationState={component.validation ? (component.validation.isValid ? 'none' : 'error') : 'none'}
				required={component.required}
				// @ts-ignore there's a bug in the typings somewhere, so ignoring this line to avoid angering type-checker
				label={
					component.tooltip
						? {
							children: (_: unknown, slotProps: LabelProps) => (
								<InfoLabel {...slotProps} info={component.tooltip}>
									{ component.label }
								</InfoLabel>
							)
						}
						: component.label}
			>
				{ generateFormComponent(connectionDialogContext, component, idx) }
			</Field>
			{
				component?.actionButtons?.length! > 0 &&
				<div className={formStyles.formComponentActionDiv}>
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
							})}>{actionButton.label}</Button>;
						})
					}
				</div>
			}
		</div>
	);
};

export function generateFormField(connectionDialogContext: ConnectionDialogContextProps, component: FormComponent, idx: number, formStyles: Record<"formRoot" | "formDiv" | "formComponentDiv" | "formComponentActionDiv", string>) {
	return (
		<div className={formStyles.formComponentDiv} key={idx}>
			<Field
				validationMessage={component.validation?.validationMessage ?? ''}
				orientation={component.type === FormComponentType.Checkbox ? 'horizontal' : 'vertical'}
				validationState={component.validation ? (component.validation.isValid ? 'none' : 'error') : 'none'}
				required={component.required}
				label={component.label}>
				{ generateFormComponent(connectionDialogContext, component, idx) }
			</Field>
			{
				component?.actionButtons?.length! > 0 &&
				<div className={formStyles.formComponentActionDiv}>
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
							})}>{actionButton.label}</Button>;
						})
					}
				</div>
			}
		</div>
	);
}

export function generateFormComponent(connectionDialogContext: ConnectionDialogContextProps, component: FormComponent,  _idx: number) {
	const profile = connectionDialogContext.state.connectionProfile;

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
						return <Option key={component.propertyName + idx} value={option.value}>{option.displayName}</Option>;
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
}

export const useFormStyles = makeStyles({
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