/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Field, MessageBar, Spinner } from "@fluentui/react-components";
import { ApiStatus, FormComponentType } from "../../../sharedInterfaces/connectionDialog";
import { useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { generateFormComponent, useFormStyles } from "./formUtils";

export const ConnectionStringPage = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const classes = useFormStyles();

	if (connectionDialogContext === undefined) {
		return undefined;
	}

	return (
		<div className={classes.formDiv}>
			{
				connectionDialogContext?.state.formError &&
				<MessageBar intent="error">
					{connectionDialogContext.state.formError}
				</MessageBar>
			}
			{
				connectionDialogContext.state.formTabs.filter(t => t.tab === connectionDialogContext.state.selectedFormTab)[0].components.map((component, idx) => {
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
							{generateFormComponent(connectionDialogContext, component, connectionDialogContext.state.connectionProfile, idx)}
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
										})}>{actionButton.label}</Button>;
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
	);
};