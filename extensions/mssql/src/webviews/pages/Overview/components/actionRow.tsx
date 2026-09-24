/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Menu,
    MenuButtonProps,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    SplitButton,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    BookOpen20Regular,
    CloudArrowUp20Regular,
    DocumentAdd20Regular,
    FolderOpen20Regular,
} from "@fluentui/react-icons";

import { AddConnectionIcon } from "../../../common/icons/addConnection";
import { AzureSqlDatabaseIcon } from "../../../common/icons/azureSqlDatabase";
import { DockerIcon } from "../../../common/icons/docker";
import { SqlDbInFabricIcon } from "../../../common/icons/sqlDbInFabric";
import { OverviewActionId } from "../../../../sharedInterfaces/overview";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    freeBadge: {
        marginLeft: tokens.spacingHorizontalS,
    },
    deploymentIcon: {
        width: "20px",
        height: "20px",
    },
});

export const ActionRow = () => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { runAction } = useOverviewActions();

    return (
        <div className={classes.root}>
            <Button
                appearance="primary"
                icon={<AddConnectionIcon />}
                onClick={() => runAction(OverviewActionId.AddConnection)}>
                {loc.addConnection}
            </Button>

            <Menu positioning="below-end">
                <MenuTrigger disableButtonEnhancement>
                    {(triggerProps: MenuButtonProps) => (
                        <SplitButton
                            appearance="primary"
                            menuButton={{ ...triggerProps, "aria-label": loc.moreDeployOptions }}
                            primaryActionButton={{
                                onClick: () => runAction(OverviewActionId.NewDeployment),
                            }}
                            icon={<CloudArrowUp20Regular />}>
                            {loc.deploy}
                        </SplitButton>
                    )}
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            icon={
                                <DockerIcon className={classes.deploymentIcon} aria-hidden="true" />
                            }
                            onClick={() => runAction(OverviewActionId.NewLocalContainer)}>
                            {loc.newLocalContainer}
                        </MenuItem>
                        <MenuItem
                            icon={
                                <SqlDbInFabricIcon
                                    className={classes.deploymentIcon}
                                    aria-hidden="true"
                                />
                            }
                            onClick={() => runAction(OverviewActionId.NewFabricDatabase)}>
                            {loc.newFabricDatabase}
                        </MenuItem>
                        <MenuItem
                            icon={
                                <AzureSqlDatabaseIcon
                                    className={classes.deploymentIcon}
                                    aria-hidden="true"
                                />
                            }
                            onClick={() => runAction(OverviewActionId.NewAzureSqlDatabase)}>
                            {loc.newAzureSqlDatabase}
                            <Badge
                                className={classes.freeBadge}
                                appearance="tint"
                                color="success"
                                size="small">
                                {loc.freeTag}
                            </Badge>
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>

            <Menu positioning="below-end">
                <MenuTrigger disableButtonEnhancement>
                    {(triggerProps: MenuButtonProps) => (
                        <SplitButton
                            appearance="primary"
                            menuButton={{ ...triggerProps, "aria-label": loc.moreNewOptions }}
                            primaryActionButton={{
                                onClick: () => runAction(OverviewActionId.NewQuery),
                            }}
                            icon={<DocumentAdd20Regular />}>
                            {loc.newQuery}
                        </SplitButton>
                    )}
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            icon={<BookOpen20Regular />}
                            onClick={() => runAction(OverviewActionId.NewNotebook)}>
                            {loc.newNotebook}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>

            <Button
                appearance="subtle"
                icon={<FolderOpen20Regular />}
                onClick={() => runAction(OverviewActionId.OpenSqlFile)}>
                {loc.openSqlFile}
            </Button>
        </div>
    );
};
