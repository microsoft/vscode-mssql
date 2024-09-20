/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
// import { FormField } from "../../common/forms/form.component";
import { ConnectButton } from "./components/connectButton.component";
import { Dropdown, Field, Textarea, Option, Button } from "@fluentui/react-components";
import { FormField, useFormStyles } from "../../common/forms/form.component";
import { FormItemSpec } from "../../common/forms/form";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { locConstants } from "../../common/locConstants";
import { TestConnectionButton } from "./components/testConnectionButton.component";

function removeDuplicates<T>(array: T[]): T[] {
	return Array.from(new Set(array));
}

export const AzureBrowsePage = () => {
	const context = useContext(ConnectionDialogContext);
	const formStyles = useFormStyles();
	const [selectedSubscription, setSelectedSubscription] = useState<string | undefined>(undefined);
	const [selectedResourceGroup, setSelectedResourceGroup] = useState<string | undefined>(undefined);
	const [selectedLocation, setSelectedLocation] = useState<string | undefined>(undefined);
	const [_selectedServer, setSelectedServer] = useState<string | undefined>(undefined);
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

	if (context === undefined) {
		return undefined;
	}

	let activeServers = context.state.azureDatabases;

	const subscriptions = removeDuplicates(context.state.azureDatabases.map(server => server.subscriptionId));

	if (selectedSubscription) {
		activeServers = activeServers.filter(server => server.subscriptionId === selectedSubscription);
	}

	const resourceGroups = removeDuplicates(activeServers.map(server => server.resourceGroup));

	if (selectedResourceGroup) {
		activeServers = activeServers.filter(server => server.resourceGroup === selectedResourceGroup);
	}

	const locations = removeDuplicates(activeServers.map(server => server.location));

	if (selectedLocation) {
		activeServers = activeServers.filter(server => server.location === selectedLocation);
	}

	const servers = removeDuplicates(activeServers.map(server => server.server));

	return (
		<div>
			<div className={formStyles.formComponentDiv}>
				<Textarea
					value={context.state.azureDatabases.map((server, _idx) => JSON.stringify(server)).join('\n')}
					style={{ height: '200px', width: '100%', margin: '10px 0px' }}
				/>
			</div>
			<AzureBrowseDropdown label="Subscription" valueList={subscriptions} setValue={setSelectedSubscription} />
			<AzureBrowseDropdown label="Resource Group" valueList={resourceGroups} setValue={setSelectedResourceGroup} />
			<AzureBrowseDropdown label="Location" valueList={locations} setValue={setSelectedLocation} />
			<AzureBrowseDropdown label="Server" valueList={servers} setValue={setSelectedServer} />

            {context.state.connectionComponents.mainOptions.filter(opt => !['server', 'database'].includes(opt)).map(
                (inputName, idx) => {
                    const component = context.state.connectionComponents.components[inputName as keyof IConnectionDialogProfile];
                    if (component.hidden === true) {
                        return undefined;
                    }

                    return (
                        <FormField
                            key={idx}
                            context={context}
                            component={component as FormItemSpec<IConnectionDialogProfile>}
                            idx={idx}
                            props={{ orientation: 'horizontal' }}
                        />
                    );
                }
            )}

            <AdvancedOptionsDrawer isAdvancedDrawerOpen={isAdvancedDrawerOpen} setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen} />
            <div className={formStyles.formNavTray}>
                <Button
                    shape="square"
                    onClick={(_event) => {
                        setIsAdvancedDrawerOpen(!isAdvancedDrawerOpen);
                    }}
                    className={formStyles.formNavTrayButton}
                >
                    {locConstants.connectionDialog.advancedSettings}
                </Button>
                <div className={formStyles.formNavTrayRight}>
                    <TestConnectionButton className={formStyles.formNavTrayButton}/>
                    <ConnectButton className={formStyles.formNavTrayButton}/>
                </div>
            </div>
		</div>
	);
};

const AzureBrowseDropdown = ({label, valueList, setValue}: {label: string, valueList: string[], setValue: (value: string|undefined) => void}) => {
	const formStyles = useFormStyles();

	return (
		<div className={formStyles.formComponentDiv}>
			<Field label={label} orientation="horizontal">
				<Dropdown
					onOptionSelect={(_event, data) => {
						setValue(data.optionValue);
					}}
				>
					{valueList.map((loc, idx) => {
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
	);
};