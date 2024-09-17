/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
// import { FormField } from "../../common/forms/form.component";
import { ConnectButton } from "./connectButton";
import { Dropdown, Field, Textarea, Option } from "@fluentui/react-components";
import { useFormStyles } from "../../common/forms/form.component";

export const AzureBrowsePage = () => {
	const context = useContext(ConnectionDialogContext);
	const formStyles = useFormStyles();
	const [selectedSubscription, setSelectedSubscription] = useState<string | undefined>(undefined);

	if (context === undefined) {
		return undefined;
	}

	const subscriptions = context.state.azureDatabases.map(server => server.subscriptionId);
	const resourceGroups = context.state.azureDatabases.map(server => server.resourceGroup);
	const locations = context.state.azureDatabases.map(server => server.location);

	return (
		<div>
			{/* <FormField
				key={index++}
				context={connectionDialogContext}
				component={connectionDialogContext.state.connectionComponents.components['connectionString'] as FormItemSpec<IConnectionDialogProfile>}
				idx={index}
				props={{ orientation: 'horizontal' }}
			/> */}
			<div className={formStyles.formComponentDiv}>
				<Textarea
					value={context.state.azureDatabases.map((server, _idx) => JSON.stringify(server)).join('\n')}
					style={{ height: '200px', width: '100%', margin: '10px 0px' }}
				/>
			</div>
			<div className={formStyles.formComponentDiv}>
				<Field label="Subscription" orientation="horizontal">
					<Dropdown>
						{subscriptions.map((subscription, idx) => {
							return (
								<Option
									key={idx}
									value={subscription}
								>
									{subscription}
								</Option>
							);
						})}
					</Dropdown>
				</Field>
			</div>
			<div className={formStyles.formComponentDiv}>
				<Field label="Resource Group" orientation="horizontal">
					<Dropdown>
						{resourceGroups.map((rg, idx) => {
							return (
								<Option
									key={idx}
									value={rg}
								>
									{rg}
								</Option>
							);
						})}
					</Dropdown>
				</Field>
			</div>
			<div className={formStyles.formComponentDiv}>
				<Field label="Location" orientation="horizontal">
					<Dropdown>
						{locations.map((loc, idx) => {
							return (
								<Option
									key={idx}
									value={loc}
								>
									{loc}
								</Option>
							);
						})}
					</Dropdown>
				</Field>
			</div>

            <div className={formStyles.formNavTray}>
				<div className={formStyles.formNavTrayRight}>
					<ConnectButton className={formStyles.formNavTrayButton}/>
				</div>
			</div>
		</div>
	);
};