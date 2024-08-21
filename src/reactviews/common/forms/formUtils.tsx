/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { Input, Button, Textarea, Dropdown, Checkbox, Option, makeStyles } from "@fluentui/react-components";
import { EyeRegular, EyeOffRegular } from "@fluentui/react-icons";

import { ConnectionDialogContextProps, FormComponent, FormComponentType, IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { ConnectionDialogContext } from "../../pages/ConnectionDialog/connectionDialogStateProvider";

export const FormInput = ({ value, target, type }: { value: string, target: keyof IConnectionDialogProfile, type: 'input' | 'password' | 'textarea' }) => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const [inputVal, setValueVal] = useState(value);
	const [showPassword, setShowPassword] = useState(false);

	useEffect(() => {
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

export function generateFormComponent(connectionDialogContext: ConnectionDialogContextProps, component: FormComponent, profile: IConnectionDialogProfile, _idx: number) {
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