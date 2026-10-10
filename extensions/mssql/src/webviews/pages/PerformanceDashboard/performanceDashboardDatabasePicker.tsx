/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import { Database16Regular } from "@fluentui/react-icons";
import { useMemo } from "react";
import {
    ListDatabasesRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    SwitchDatabaseRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import {
    SearchableDropdown,
    SearchableDropdownOptions,
} from "../../common/searchableDropdown.component";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";

const useStyles = makeStyles({
    picker: {
        flexShrink: 0,
        // The database is the subject of the dashboard, so its name stands out.
        "& .fui-Button .fui-Text": {
            fontWeight: tokens.fontWeightSemibold,
        },
    },
    icon: {
        display: "flex",
        flexShrink: 0,
        color: tokens.colorNeutralForeground2,
    },
});

/**
 * Shows the dashboard's database and switches to another database of the server. After a switch,
 * the dashboard goes to the tab of its current location, because a query or session ID does not
 * apply to another database.
 */
export const PerformanceDashboardDatabasePicker = () => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const { router, match, navigate } = useNavigation();
    const serverName = usePerformanceDashboardSelector((state) => state.serverName);
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const list = useExtensionRequest(ListDatabasesRequest.type, undefined, databaseName);
    const databases = list.result?.databases ?? [];
    const errorMessage = list.result?.errorMessage ?? list.errorMessage;

    const options = useMemo<SearchableDropdownOptions[]>(() => {
        const names =
            databaseName && !databases.includes(databaseName)
                ? [databaseName, ...databases]
                : databases;
        return names.map((name) => ({ value: name }));
    }, [databases, databaseName]);

    const selectDatabase = async (database: string) => {
        if (database === databaseName) {
            return;
        }
        const { switched } = await extensionRpc.sendRequest(SwitchDatabaseRequest.type, {
            database,
        });
        if (switched) {
            // Keep the options of a top page, such as the overview's time range.
            const top = router.topRoute(match);
            navigate(router.build(top.id, {}, match.route.id === top.id ? match.query : {}));
        }
    };

    const tooltip = errorMessage
        ? loc.performanceDashboard.databaseListFailed(errorMessage)
        : databaseName
          ? loc.performanceDashboard.serverAndDatabase(serverName, databaseName)
          : serverName;

    return (
        <span className={classes.picker} title={tooltip}>
            <SearchableDropdown
                size="medium"
                ariaLabel={loc.performanceDashboard.database}
                searchBoxPlaceholder={loc.performanceDashboard.searchDatabases}
                options={options}
                selectedOption={databaseName ? { value: databaseName } : undefined}
                placeholder={serverName}
                showPlaceholder={!databaseName}
                onSelect={(option) => void selectDatabase(option.value)}
                renderDecoration={() => (
                    <span className={classes.icon}>
                        <Database16Regular />
                    </span>
                )}
                style={{ paddingInline: "10px" }}
            />
        </span>
    );
};
