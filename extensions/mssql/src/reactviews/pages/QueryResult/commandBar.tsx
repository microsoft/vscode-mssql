/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Overflow,
  OverflowItem,
  Toolbar,
  ToolbarButton,
  ToolbarButtonProps,
  useIsOverflowItemVisible,
  useOverflowMenu,
} from "@fluentui/react-components";
import { ReactElement, useContext } from "react";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { useQueryResultSelector } from "./queryResultSelector";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import {
  saveAsCsvIcon,
  saveAsExcelIcon,
  saveAsJsonIcon,
  saveAsInsertIcon,
} from "./queryResultUtils";
import { QueryResultSaveAsTrigger } from "../../../sharedInterfaces/queryResult";
import {
  ArrowMaximize16Filled,
  ArrowMinimize16Filled,
  DocumentTextRegular,
  MoreVertical20Filled,
  TableRegular,
} from "@fluentui/react-icons";
import { WebviewAction } from "../../../sharedInterfaces/webview";
import { ACTIONBAR_WIDTH_PX } from "./table/table";

const useStyles = makeStyles({
  commandBarContainer: {
    width: `${ACTIONBAR_WIDTH_PX}px`,
    flexShrink: 0,
    overflow: "hidden",
    display: "flex",
    paddingRight: "10px",
  },
  commandBar: {
    width: "100%",
  },
  buttonImg: {
    display: "block",
    height: "16px",
    width: "16px",
  },
  toolbarButton: {
    width: "32px",
    height: "32px",
    minWidth: "32px",
    minHeight: "32px",
    padding: "4px",
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
});

export interface CommandBarProps {
  uri?: string;
  resultSetSummary?: qr.ResultSetSummary;
  viewMode?: qr.QueryResultViewMode;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
}

type ToolbarOverflowButtonProps = {
  overflowId: string;
  overflowGroupId?: string;
} & ToolbarButtonProps;

type CommandBarAction = {
  id: string;
  groupId?: string;
  icon: ReactElement;
  menuIcon?: ReactElement;
  ariaLabel: string;
  title: string;
  menuLabel: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
};

const ToolbarOverflowButton = ({
  overflowId,
  overflowGroupId,
  className,
  ...props
}: ToolbarOverflowButtonProps & { className?: string }) => {
  const classes = useStyles();
  const mergedClassName = [classes.toolbarButton, className]
    .filter(Boolean)
    .join(" ");
  return (
    <OverflowItem id={overflowId} groupId={overflowGroupId}>
      <ToolbarButton
        appearance="subtle"
        {...props}
        className={mergedClassName}
      />
    </OverflowItem>
  );
};

const CommandBarOverflowMenuItem = ({
  action,
}: {
  action: CommandBarAction;
}) => {
  const isVisible = useIsOverflowItemVisible(action.id);
  if (isVisible) {
    return null;
  }
  return <MenuItem onClick={action.onClick}>{action.menuLabel}</MenuItem>;
};

const CommandBarOverflowMenu = ({
  actions,
}: {
  actions: CommandBarAction[];
}) => {
  const { ref, isOverflowing } = useOverflowMenu<HTMLButtonElement>();
  if (!isOverflowing) {
    return null;
  }

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <ToolbarButton
          ref={ref}
          appearance="subtle"
          icon={<MoreVertical20Filled />}
          aria-label={locConstants.queryResult.moreQueryActions}
          title={locConstants.queryResult.moreQueryActions}
        />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {actions.map((action) => (
            <CommandBarOverflowMenuItem key={action.id} action={action} />
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};

const CommandBar = (props: CommandBarProps) => {
  const classes = useStyles();
  const { themeKind } = useVscodeWebview2<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers
  >();
  const context = useContext(QueryResultCommandsContext);
  const resultSetSummaries = useQueryResultSelector<
    Record<number, Record<number, qr.ResultSetSummary>>
  >((s) => s.resultSetSummaries);
  const selection = useQueryResultSelector<qr.ISlickRange[] | undefined>(
    (s) => s.selection,
  );
  const { keyBindings } = useVscodeWebview2();

  const maximizeShortcut = keyBindings[WebviewAction.QueryResultMaximizeGrid];
  const restoreShortcut = keyBindings[WebviewAction.QueryResultMaximizeGrid];
  const toggleViewShortcut =
    keyBindings[WebviewAction.QueryResultSwitchToTextView];
  const saveAsJsonShortcut = keyBindings[WebviewAction.QueryResultSaveAsJson];
  const saveAsCsvShortcut = keyBindings[WebviewAction.QueryResultSaveAsCsv];
  const saveAsExcelShortcut = keyBindings[WebviewAction.QueryResultSaveAsExcel];
  const saveAsInsertShortcut =
    keyBindings[WebviewAction.QueryResultSaveAsInsert];

  if (context === undefined) {
    return undefined;
  }

  const saveResults = (buttonLabel: string) => {
    void context.extensionRpc.sendRequest(qr.SaveResultsWebviewRequest.type, {
      uri: props.uri ?? "",
      batchId: props.resultSetSummary?.batchId,
      resultId: props.resultSetSummary?.id,
      format: buttonLabel,
      selection: selection,
      origin: QueryResultSaveAsTrigger.Toolbar,
    });
  };

  const toggleViewMode = () => {
    const newMode =
      props.viewMode === qr.QueryResultViewMode.Grid
        ? qr.QueryResultViewMode.Text
        : qr.QueryResultViewMode.Grid;
    context.setResultViewMode(newMode);
  };

  const checkMultipleResults = () => {
    if (Object.keys(resultSetSummaries).length > 1) {
      return true;
    }
    for (let resultSet of Object.values(resultSetSummaries)) {
      if (Object.keys(resultSet).length > 1) {
        return true;
      }
    }
    return false;
  };

  const hasMultipleResults = () => {
    return Object.keys(resultSetSummaries).length > 0 && checkMultipleResults();
  };

  const isMaximized = props.isMaximized ?? false;
  const maximizeTooltip = locConstants.queryResult.maximize(
    maximizeShortcut?.label,
  );
  const restoreTooltip = locConstants.queryResult.restore(
    restoreShortcut?.label,
  );
  const toggleToGridViewTooltip = locConstants.queryResult.toggleToGridView(
    toggleViewShortcut?.label,
  );
  const toggleToTextViewTooltip = locConstants.queryResult.toggleToTextView(
    toggleViewShortcut?.label,
  );
  const saveAsCsvTooltip = locConstants.queryResult.saveAsCsv(
    saveAsCsvShortcut?.label,
  );
  const saveAsJsonTooltip = locConstants.queryResult.saveAsJson(
    saveAsJsonShortcut?.label,
  );
  const saveAsExcelTooltip = locConstants.queryResult.saveAsExcel(
    saveAsExcelShortcut?.label,
  );
  const saveAsInsertTooltip = locConstants.queryResult.saveAsInsert(
    saveAsInsertShortcut?.label,
  );

  const isGridView = props.viewMode === qr.QueryResultViewMode.Grid;
  const hasAdditionalResults = hasMultipleResults();
  const toggleToGrid = props.viewMode === qr.QueryResultViewMode.Text;

  const actions: CommandBarAction[] = [
    {
      id: "toggleViewMode",
      groupId: "viewMode",
      icon: toggleToGrid ? <TableRegular /> : <DocumentTextRegular />,
      ariaLabel: toggleToGrid
        ? toggleToGridViewTooltip
        : toggleToTextViewTooltip,
      title: toggleToGrid ? toggleToGridViewTooltip : toggleToTextViewTooltip,
      menuLabel: toggleToGrid
        ? toggleToGridViewTooltip
        : toggleToTextViewTooltip,
      onClick: toggleViewMode,
    },
  ];

  if (isGridView && hasAdditionalResults) {
    actions.push({
      id: "toggleMaximize",
      groupId: "viewMode",
      icon: props.isMaximized ? (
        <ArrowMinimize16Filled className={classes.buttonImg} />
      ) : (
        <ArrowMaximize16Filled className={classes.buttonImg} />
      ),
      ariaLabel: isMaximized ? restoreTooltip : maximizeTooltip,
      title: isMaximized ? restoreTooltip : maximizeTooltip,
      menuLabel: isMaximized ? restoreTooltip : maximizeTooltip,
      onClick: () => props.onToggleMaximize?.(),
    });
  }

  if (isGridView) {
    actions.push(
      {
        id: "saveAsCsv",
        groupId: "export",
        icon: (
          <img className={classes.buttonImg} src={saveAsCsvIcon(themeKind)} />
        ),
        menuLabel: saveAsCsvTooltip,
        ariaLabel: saveAsCsvTooltip,
        title: saveAsCsvTooltip,
        onClick: () => saveResults("csv"),
        className: "codicon saveCsv",
      },
      {
        id: "saveAsJson",
        groupId: "export",
        icon: (
          <img className={classes.buttonImg} src={saveAsJsonIcon(themeKind)} />
        ),
        menuLabel: saveAsJsonTooltip,
        ariaLabel: saveAsJsonTooltip,
        title: saveAsJsonTooltip,
        onClick: () => saveResults("json"),
        className: "codicon saveJson",
      },
      {
        id: "saveAsExcel",
        groupId: "export",
        icon: (
          <img className={classes.buttonImg} src={saveAsExcelIcon(themeKind)} />
        ),
        menuLabel: saveAsExcelTooltip,
        ariaLabel: saveAsExcelTooltip,
        title: saveAsExcelTooltip,
        onClick: () => saveResults("excel"),
        className: "codicon saveExcel",
      },
      {
        id: "saveAsInsert",
        groupId: "export",
        icon: (
          <img
            className={classes.buttonImg}
            src={saveAsInsertIcon(themeKind)}
          />
        ),
        menuLabel: saveAsInsertTooltip,
        ariaLabel: saveAsInsertTooltip,
        title: saveAsInsertTooltip,
        onClick: () => saveResults("insert"),
        className: "codicon saveInsert",
      },
    );
  }

  return (
    <div className={classes.commandBarContainer}>
      <Overflow overflowAxis="vertical" overflowDirection="end">
        <Toolbar
          vertical
          className={classes.commandBar}
          aria-label="Query result commands"
        >
          {actions.map((action) => (
            <ToolbarOverflowButton
              key={action.id}
              overflowId={action.id}
              overflowGroupId={action.groupId}
              icon={action.icon}
              aria-label={action.ariaLabel}
              title={action.title}
              onClick={action.onClick}
              disabled={action.disabled}
              className={action.className}
            />
          ))}
          <CommandBarOverflowMenu actions={actions} />
        </Toolbar>
      </Overflow>
    </div>
  );
};

export default CommandBar;
