/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { Field, MessageBar, Radio, RadioGroup } from "@fluentui/react-components";
import { ConnectionDialogContextProps, IConnectionDialogProfile, ConnectionInputMode } from "../../../sharedInterfaces/connectionDialog";
import './sqlServerRotation.css';
import { ConnectionHeader } from "./connectionHeader";
import { ConnectionFormPage } from "./connectionFormPage";
import { ConnectionStringPage } from "./connectionStringPage";
import * as l10n from '@vscode/l10n';
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { FormItemSpec } from "../../common/forms/form";

function renderContent(connectionDialogContext: ConnectionDialogContextProps): ReactNode {
	switch (connectionDialogContext?.state.selectedInputMode) {
		case ConnectionInputMode.Parameters:
			return <ConnectionFormPage />;
		case ConnectionInputMode.ConnectionString:
			return <ConnectionStringPage />;
	}
}

export const ConnectionInfoFormContainer = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const formStyles = useFormStyles();

	const PARAMETERS = l10n.t("Parameters");
	const CONNECTION_STRING = l10n.t("Connection String");
	const BROWSE_AZURE = l10n.t("Browse Azure");

	if (!connectionDialogContext?.state) {
		return undefined;
	}

	return (
		<div className={formStyles.formRoot}>
			<ConnectionHeader />

			<div className={formStyles.formDiv}>
				{
					connectionDialogContext?.state.formError &&
					<MessageBar intent="error">
						{connectionDialogContext.state.formError}
					</MessageBar>
				}
				<FormField
					context={connectionDialogContext}
					component={connectionDialogContext.state.connectionComponents.components['profileName'] as FormItemSpec<IConnectionDialogProfile>}
					idx={0}
					props={{ orientation: 'horizontal' }}
				/>

				<div className={formStyles.formComponentDiv}>
					<Field label="Input type" orientation="horizontal">
						<RadioGroup
							onChange={(_, data) => { connectionDialogContext.setConnectionInputType(data.value as ConnectionInputMode); }}
							value={connectionDialogContext.state.selectedInputMode}
						>
							<Radio value={ConnectionInputMode.Parameters} label={PARAMETERS} />
							<Radio value={ConnectionInputMode.ConnectionString} label={CONNECTION_STRING} />
							<Radio value={ConnectionInputMode.AzureBrowse} label={BROWSE_AZURE} />
						</RadioGroup>
					</Field>
				</div>
				<div style={{ overflow: 'auto' }}>
					{renderContent(connectionDialogContext)}
				</div>
			</div>
		</div>
	);
};