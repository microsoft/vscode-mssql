/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner } from "@fluentui/react-components";
import { CSSProperties, useContext } from "react";
import { ConnectionDialogContext } from "./../connectionDialogStateProvider";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";

export const ConnectButtonId = "connectButton";

export const ConnectButton = ({
  style,
  className,
}: {
  style?: CSSProperties;
  className?: string;
}) => {
  const context = useContext(ConnectionDialogContext);

  if (!context) {
    return undefined;
  }

  return (
    <Button
      id={ConnectButtonId}
      type="submit"
      appearance="primary"
      disabled={
        context.state.connectionStatus === ApiStatus.Loading ||
        !context.state.readyToConnect
      }
      className={className}
      style={style}
      iconPosition="after"
      icon={
        context.state.connectionStatus === ApiStatus.Loading ? (
          <Spinner size="tiny" />
        ) : undefined
      }
    >
      {locConstants.connectionDialog.connect}
    </Button>
  );
};
