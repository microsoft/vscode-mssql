/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { Tab, TabList, makeStyles } from "@fluentui/react-components";
import { ConnectionDialogContextProps, FormTabType } from "../../../sharedInterfaces/connectionDialog";
import './sqlServerRotation.css';
import { ConnectionHeader } from "./connectionHeader";
import { ConnectionFormPage } from "./connectionFormPage";
import { ConnectionStringPage } from "./connectionStringPage";
import { useFormStyles } from "../../common/forms/form.component";

function renderTab(connectionDialogContext: ConnectionDialogContextProps): ReactNode {
	switch (connectionDialogContext?.state.selectedFormTab) {
		case FormTabType.Parameters:
			return <ConnectionFormPage />;
		case FormTabType.ConnectionString:
			return <ConnectionStringPage />;
	}
}

export const ConnectionInfoFormContainer = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const formStyles = useFormStyles();

	if (!connectionDialogContext?.state) {
		return undefined;
	}

	return (
		<div className={formStyles.formRoot}>
			<ConnectionHeader />
			<TabList
				selectedValue={connectionDialogContext?.state?.selectedFormTab ?? FormTabType.Parameters}
				onTabSelect={(_event, data) => { connectionDialogContext?.setFormTab(data.value as FormTabType); }}
			>
				<Tab value={FormTabType.Parameters}>Parameters</Tab>
				<Tab value={FormTabType.ConnectionString}>Connection String</Tab>
			</TabList>
			<div style={ { overflow: 'auto' } }>
				{ renderTab(connectionDialogContext) }
			</div>
		</div>
	);
};