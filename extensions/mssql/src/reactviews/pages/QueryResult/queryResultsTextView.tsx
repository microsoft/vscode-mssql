/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useQueryResultSelector } from "./queryResultSelector";
import { TextView } from "./textView";
import * as qr from "../../../sharedInterfaces/queryResult";
import { makeStyles } from "@fluentui/react-components";
import { ACTIONBAR_WIDTH_PX } from "./table/table";
import CommandBar from "./commandBar";

const useStyles = makeStyles({
  textViewContainer: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    fontWeight: "normal",
  },
});

export const QueryResultsTextView = () => {
  const classes = useStyles();
  const uri = useQueryResultSelector((state) => state.uri);
  const viewMode =
    useQueryResultSelector((state) => state.tabStates?.resultViewMode) ??
    qr.QueryResultViewMode.Grid;

  return (
    <div className={classes.textViewContainer}>
      <div style={{ flex: 1, display: "flex", flexDirection: "row" }}>
        <div
          style={{
            width: `calc(100% - ${ACTIONBAR_WIDTH_PX}px)`,
            height: "100%",
          }}
        >
          <TextView />
        </div>
        <CommandBar uri={uri} viewMode={viewMode} />
      </div>
    </div>
  );
};
