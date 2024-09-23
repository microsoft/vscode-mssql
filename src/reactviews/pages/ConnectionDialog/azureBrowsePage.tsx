/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
// import { FormField } from "../../common/forms/form.component";
import { ConnectButton } from "./components/connectButton.component";
import { Dropdown, Field, Option, Button } from "@fluentui/react-components";
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
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);

	if (context === undefined) {
		return undefined;
	}

	const [subscriptions, setSubscriptions] = useState<string[]>([]);
	const [selectedSubscription, setSelectedSubscription] = useState<string | undefined>(undefined);

	const [resourceGroups, setResourceGroups] = useState<string[]>([]);
	const [selectedResourceGroup, setSelectedResourceGroup] = useState<string | undefined>(undefined);

	const [locations, setLocations] = useState<string[]>([]);
	const [selectedLocation, setSelectedLocation] = useState<string | undefined>(undefined);

	// const [servers, setServers] = useState<string[]>([]);
	// const [selectedServer, setSelectedServer] = useState<string | undefined>(undefined);

	// const [databases, setDatabases] = useState<string[]>([]);
	// const [selectedDatabase, setSelectedDatabase] = useState<string | undefined>(undefined);

	useEffect(() => {
		const subs = removeDuplicates(context.state.azureDatabases.map(server => server.subscriptionId));
		setSubscriptions(subs);

		if (subs.length === 1) {
			setSelectedSubscription(subs[0]);
		}

	}, [context.state.azureDatabases]);

	useEffect(() => {
		let activeServers = context.state.azureDatabases;

		if (selectedSubscription) {
			activeServers = activeServers.filter(server => server.subscriptionId === selectedSubscription);
		}

		const rgs = removeDuplicates(activeServers.map(server => server.resourceGroup));
		setResourceGroups(rgs);

		if (rgs.length === 1) {
			setSelectedResourceGroup(rgs[0]);
		}

	}, [subscriptions, selectedSubscription]);

	useEffect(() => {
		let activeServers = context.state.azureDatabases;

		if (selectedSubscription) {
			activeServers = activeServers.filter(server => server.subscriptionId === selectedSubscription);
		}

		if (selectedResourceGroup) {
			activeServers = activeServers.filter(server => server.resourceGroup === selectedResourceGroup);
		}

		const locs = removeDuplicates(activeServers.map(server => server.location));

		setLocations(locs);

		if (locs.length === 1) {
			setSelectedLocation(locs[0]);
		}
	}, [resourceGroups, selectedResourceGroup]);

	// useEffect(() => {

	// }, [selectedLocation]);

	// useEffect(() => {
	// 	if (subscriptions.length === 1) {
	// 		setSelectedSubscription(subscriptions[0]);
	// 	}
	// }, [subscriptions]);


	// useEffect(() => {
	// 	if (selectedServer) {
	// 		databases = activeServers.find(server => server.server === selectedServer)!.databases;
	// 	}

	// 	if (databases.length === 1) {
	// 		setSelectedDatabase(databases[0]);
	// 	}
    // }, [selectedServer]);

	return (
		<div>
			<AzureBrowseDropdown label="Subscription" clearable content={{valueList: subscriptions, setValue: setSelectedSubscription, currentValue: selectedSubscription, dependentValues: [setSelectedResourceGroup, setSelectedLocation, /*setSelectedServer, setSelectedDatabase*/]}}/>
			<AzureBrowseDropdown label="Resource Group" clearable content={{valueList: resourceGroups, setValue: setSelectedResourceGroup, currentValue: selectedResourceGroup, dependentValues: [setSelectedLocation, /*setSelectedServer, setSelectedDatabase*/]}}/>
			<AzureBrowseDropdown label="Location" clearable content={{valueList: locations, setValue: setSelectedLocation, currentValue: selectedLocation, dependentValues: [/*setSelectedServer, setSelectedDatabase*/]}}/>
			{/* <AzureBrowseDropdown label="Server" content={{valueList: servers, setValue: setSelectedServer, currentValue: selectedServer, dependentValues: [setSelectedDatabase]}} required={true} /> */}

			{/* {selectedServer && (
				<>
					<FormField
						context={context}
						component={context.state.connectionComponents.components['trustServerCertificate'] as FormItemSpec<IConnectionDialogProfile>}
						idx={0}
						props={{ orientation: 'horizontal' }}
					/>
					<AzureBrowseDropdown label="Database" content={{valueList: databases, setValue: setSelectedDatabase, currentValue: selectedDatabase}} />
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
				</>
			)} */}

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

const AzureBrowseDropdown = ({
	label,
	required,
	clearable,
	content
}: {
	label: string,
	required?: boolean,
	clearable?: boolean,
	content: {
		valueList: string[],
		setValue: (value: string|undefined) => void,
		currentValue?: string,
		dependentValues?: ((value: string|undefined) => void)[]
	}
}) => {
	const formStyles = useFormStyles();

	return (
		<div className={formStyles.formComponentDiv}>
			<Field
				label={label}
				orientation="horizontal"
				required={required}
			>
				<Dropdown
					value={content.currentValue ?? ""}
					selectedOptions={[content.currentValue]}
					clearable={clearable}
					onOptionSelect={(_event, data) => {
						if (data.optionValue === content.currentValue) {
							return;
						}

						for (const dependentValue of content.dependentValues || []) {
							dependentValue(undefined);
						}

						content.setValue(data.optionValue);
					}}
				>
					{content.valueList.map((loc, idx) => {
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