/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { FormItemSpec } from "../../common/forms/form";

export const ConnectionStringPage = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const formStyles = useFormStyles();

	if (connectionDialogContext === undefined) {
		return undefined;
	}
	let index = 0;
	return (
		<div className={formStyles.formDiv}>
			<FormField
				key={index++}
				context={connectionDialogContext}
				component={connectionDialogContext.state.connectionComponents['connectionString'] as FormItemSpec<IConnectionDialogProfile>}
				idx={index}
			/>
		</div>
	);
};