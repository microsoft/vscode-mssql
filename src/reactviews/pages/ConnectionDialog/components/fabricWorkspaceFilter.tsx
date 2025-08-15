/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeEvent, useContext } from "react";
import {
    Input,
    InputOnChangeData,
    Label,
    Menu,
    MenuButton,
    MenuCheckedValueChangeData,
    MenuCheckedValueChangeEvent,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Tooltip,
} from "@fluentui/react-components";
import { Search20Regular } from "@fluentui/react-icons";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { themeType } from "../../../common/utils";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { locConstants as Loc } from "../../../common/locConstants";

interface Props {
    onSearchInputChanged: (_: ChangeEvent<HTMLInputElement>, data: InputOnChangeData) => void;
    onFilterOptionChanged: (
        _: MenuCheckedValueChangeEvent,
        { name, checkedItems }: MenuCheckedValueChangeData,
    ) => void;
    searchValue?: string;
    selectedTypeFilters?: string[];
}

export const filterIcon = (colorTheme: ColorThemeKind) => {
    const theme = themeType(colorTheme);
    const filterIcon =
        theme === "dark"
            ? require("../../../media/filter_inverse.svg")
            : require("../../../media/filter.svg");
    return filterIcon;
};

const FabricWorkspaceFilter = ({
    onSearchInputChanged,
    onFilterOptionChanged,
    searchValue = "",
    selectedTypeFilters = [],
}: Props) => {
    const context = useContext(ConnectionDialogContext);
    const theme = context!.themeKind;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "flex-end",
                alignItems: "center",
                marginRight: "6px",
            }}>
            <Input
                style={{ marginRight: "20px" }}
                placeholder={Loc.connectionDialog.filterByKeyword}
                contentAfter={<Search20Regular aria-label={Loc.connectionDialog.filterByKeyword} />}
                onChange={onSearchInputChanged}
                value={searchValue}
            />
            <Label style={{ marginRight: "5px" }}>{Loc.connectionDialog.filter}</Label>
            <Menu>
                <MenuTrigger>
                    <Tooltip content={Loc.connectionDialog.filterByType} relationship="label">
                        <MenuButton
                            icon={
                                <img
                                    src={filterIcon(theme)}
                                    alt={Loc.connectionDialog.filter}
                                    style={{ width: "20px", height: "20px" }}
                                />
                            }
                        />
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList
                        checkedValues={{ sqlType: selectedTypeFilters }}
                        onCheckedValueChange={onFilterOptionChanged}>
                        <MenuItemRadio name="sqlType" value={Loc.connectionDialog.showAll}>
                            {Loc.connectionDialog.showAll}
                        </MenuItemRadio>
                        <MenuItemRadio
                            name="sqlType"
                            value={Loc.connectionDialog.sqlAnalyticsEndpoint}>
                            {Loc.connectionDialog.sqlAnalyticsEndpoint}
                        </MenuItemRadio>
                        <MenuItemRadio name="sqlType" value={Loc.connectionDialog.sqlDatabase}>
                            {Loc.connectionDialog.sqlDatabase}
                        </MenuItemRadio>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
};

export default FabricWorkspaceFilter;
