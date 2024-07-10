/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionDialogContext, FormTabs } from "./connectionDialogStateProvider";
import { Button, Field, InfoLabel, Input, Radio, RadioGroup, Tab, TabList, makeStyles } from "@fluentui/react-components";
import React from "react";
import { EyeRegular, EyeOffRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
	formDiv: {
		padding: '10px',
		maxWidth: '500px',
		display: 'flex',
		flexDirection: 'column',
		'> *': {
			margin: '5px',
		}
	}
});

export const ConnectionInfoFormContainer = () => {
	const state = useContext(ConnectionDialogContext);
	const classes = useStyles();
	console.log(state);
	const [showPassword, setShowPassword] = React.useState(false);
	return (
		<div>
			<TabList selectedValue={state?.state?.selectedFormTab ?? FormTabs.Parameters} onTabSelect={(_event, data) => {
				state?.setFormTab(data.value as FormTabs);
			}}>
				<Tab value={FormTabs.Parameters}>Parameters</Tab>
				<Tab value={FormTabs.ConnectionString}>Connection String</Tab>
			</TabList>
			<div>
				{
					state?.state?.selectedFormTab === FormTabs.Parameters &&
					<div className={classes.formDiv}>
						<Field size="small" orientation='horizontal' label={
							<InfoLabel size="small" required={true} info="Example info">
								Server
							</InfoLabel>
						}>
							<Input size="small" value={state?.state.loadedConnection ? state.state.loadedConnection.server : ''} />
						</Field>
						<Field size="small" orientation='horizontal' required={true} label='Authentication Type'>
							<RadioGroup>
								<Radio  value="sqlLogin" label="SQL Login" />
								<Radio value="integrated" label="Windows Authentication" />
								<Radio value="mfa" label="Microsoft Entra ID - Universal with MFA support" />
							</RadioGroup>
						</Field>
						{/* Username */}
						<Field orientation='horizontal' label='Username'>
							<Input value={state?.state.loadedConnection ? state.state.loadedConnection.user : ''} />
						</Field>
						{/* Password */}
						<Field size="small" orientation='horizontal' label='Password'>
							<Input
							size="small"
								type={showPassword ? 'text' : 'password'}
								contentAfter={
									<Button
										onClick={() => setShowPassword(!showPassword)}
										icon={showPassword ? <EyeRegular /> : <EyeOffRegular />}
										size="small"
										appearance="transparent"
									>
									</Button>}
							/>
						</Field>
					</div>
				}
				{
					state?.state?.selectedFormTab === FormTabs.ConnectionString &&
					<div className={classes.formDiv}>
						Connection String
					</div>
				}
			</div>
		</div>
	)
}