/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button, MessageBar, Spinner } from "@fluentui/react-components";

import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ApiStatus } from "../../../sharedInterfaces/connectionDialog";
import { FormField, useFormStyles } from "../../common/forms/formUtils";

export const ConnectionFormPage = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const formStyles = useFormStyles();

	if (connectionDialogContext === undefined) {
		return undefined;
	}

	return (
		<div className={formStyles.formDiv}>
			{
				connectionDialogContext?.state.formError &&
				<MessageBar intent="error">
					{connectionDialogContext.state.formError}
				</MessageBar>
			}
			{
				connectionDialogContext.state.connectionFormComponents.map((component, idx) => {
					if (component.hidden === true) {
						return undefined;
					}
					return (
						<FormField key={idx} connectionDialogContext={connectionDialogContext} component={component} idx={idx} />
					);
				})
			}
			<Button
				onClick={(_event) => {
					connectionDialogContext.getAdvancedProperties();
				}}
			>
				Load advanced properties
			</Button>
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