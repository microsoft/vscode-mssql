/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles, Text } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { DeploymentContext } from "../deploymentStateProvider";
import { FabricProvisioningState } from "../../../../sharedInterfaces/fabricProvisioning";

const useStyles = makeStyles({
  outerDiv: {
    display: "flex",
    flexDirection: "row",
    gap: "20px",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingBottom: "50px",
    minWidth: "750px",
    minHeight: "fit-content",
    top: 0,
    left: 0,
    paddingTop: "50px",
  },
  titleDiv: {
    fontWeight: 500,
    fontSize: "24px",
    display: "flex",
    alignItems: "center",
  },
  icon: {
    width: "58px",
    height: "58px",
  },
});

interface HeaderProps {
  paddingLeft?: string;
}

export const FabricProvisioningHeader: React.FC<HeaderProps> = ({
  paddingLeft,
}) => {
  const classes = useStyles();
  const context = useContext(DeploymentContext);
  const fabricProvisioningState = context?.state
    .deploymentTypeState as FabricProvisioningState;

  if (!context || !fabricProvisioningState) return undefined;

  return (
    <div
      className={classes.outerDiv}
      style={{ paddingLeft: paddingLeft ?? "70px" }}
    >
      <img className={classes.icon} src={sqlInFabricIcon()} />
      <Text className={classes.titleDiv}>
        {locConstants.fabricProvisioning.sqlDatabaseInFabric}
      </Text>
    </div>
  );
};

export const sqlInFabricIcon = () => {
  return require(`../../../media/sqlDbInFabric.svg`);
};
