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
    Box20Regular,
    CloudAdd20Regular,
    DocumentAdd20Regular,
    FolderOpen20Regular,
    Play20Regular,
} from "@fluentui/react-icons";

import { AddConnectionIcon } from "../../../common/icons/addConnection";
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

            {/* New: the button opens the deployment page; the menu jumps straight to one type. */}
            <Menu positioning="below-end">
                <MenuTrigger disableButtonEnhancement>
                    {(triggerProps: MenuButtonProps) => (
                        <SplitButton
                            appearance="primary"
                            menuButton={{ ...triggerProps, "aria-label": loc.moreNewOptions }}
                            primaryActionButton={{
                                onClick: () => runAction(OverviewActionId.NewDeployment),
                            }}
                            icon={<DocumentAdd20Regular />}>
                            {loc.new}
                        </SplitButton>
                    )}
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            icon={<Box20Regular />}
                            onClick={() => runAction(OverviewActionId.NewLocalContainer)}>
                            {loc.newLocalContainer}
                        </MenuItem>
                        <MenuItem
                            icon={<CloudAdd20Regular />}
                            onClick={() => runAction(OverviewActionId.NewFabricDatabase)}>
                            {loc.newFabricDatabase}
                        </MenuItem>
                        <MenuItem
                            icon={<CloudAdd20Regular />}
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

            {/* Run query: the button opens a blank SQL document; the menu offers a notebook. */}
            <Menu positioning="below-end">
                <MenuTrigger disableButtonEnhancement>
                    {(triggerProps: MenuButtonProps) => (
                        <SplitButton
                            appearance="primary"
                            menuButton={{ ...triggerProps, "aria-label": loc.moreQueryOptions }}
                            primaryActionButton={{
                                onClick: () => runAction(OverviewActionId.RunQuery),
                            }}
                            icon={<Play20Regular />}>
                            {loc.runQuery}
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
                appearance="secondary"
                icon={<FolderOpen20Regular />}
                onClick={() => runAction(OverviewActionId.OpenSqlFile)}>
                {loc.openSqlFile}
            </Button>
        </div>
    );
};
