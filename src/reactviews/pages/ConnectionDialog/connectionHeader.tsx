/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Text, Image, webLightTheme } from "@fluentui/react-components";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import * as l10n from '@vscode/l10n';

const sqlServerImage = require('../../../../media/sqlServer_light.svg');
const sqlServerImageDark = require('../../../../media/sqlServer_dark.svg');

export const ConnectionHeader = () => {
	const connectionDialogContext = useContext(ConnectionDialogContext);
	const CONNECT_TO_SQL_SERVER = l10n.t("Connect to SQL Server");
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
				src={connectionDialogContext?.theme === webLightTheme ? sqlServerImage : sqlServerImageDark} alt='SQL Server' height={60} width={60} />
			<Text size={500} style={
				{
					lineHeight: '60px'
				}
			} weight='medium'>{CONNECT_TO_SQL_SERVER}</Text>
		</div>
	);
};