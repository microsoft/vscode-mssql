/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner } from "@fluentui/react-components";
import { CSSProperties, useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import * as l10n from '@vscode/l10n';

export const ConnectButton = ({style}: {style?: CSSProperties}) => {
	const connectionDialogContext = useContext(ConnectionDialogContext);

	if (!connectionDialogContext) {
		return undefined;
	}

	const CONNECT = l10n.t("Connect");

	return (
		<Button
			appearance="primary"
			disabled={connectionDialogContext.state.connectionStatus === ApiStatus.Loading}
			shape="square"
			onClick={(_event) => { connectionDialogContext.connect(); }}
			style={
				{
					width: '150px',
					alignSelf: 'center',
                    margin: "0px 10px",
					...style
				}
			}
			iconPosition="after"
			icon={ connectionDialogContext.state.connectionStatus === ApiStatus.Loading ? <Spinner size='tiny' /> : undefined}>
				{CONNECT}
		</Button>
	);
};