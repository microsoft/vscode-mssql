/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Text, Image, webLightTheme } from "@fluentui/react-components";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { loadImage } from "../../common/loadImage";

const sqlServerImage = require('../../../../media/sqlServer.svg');
const sqlServerImageDark = require('../../../../media/sqlServer_inverse.svg');

export const ConnectionHeader = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);

	return (
		<div style={
			{
				display: 'flex',
				flexDirection: 'row',
				alignItems: 'center'
			}
		}>
			<Image style={
				{
					padding: '10px',
				}
			}
				src={connectionDialogContext?.theme === webLightTheme ? loadImage(sqlServerImage) : loadImage(sqlServerImageDark)} alt='SQL Server' height={60} width={60} />
			<Text size={500} style={
				{
					lineHeight: '60px'
				}
			} weight='medium'>Connect to SQL Server</Text>
		</div>
	);
};