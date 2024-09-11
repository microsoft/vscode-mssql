/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton } from "@fluentui/react-toolbar";
import { DocumentChevronDoubleRegular } from "@fluentui/react-icons";
import { Divider, Spinner, makeStyles, shorthands } from "@fluentui/react-components";
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { LoadState } from "../../../sharedInterfaces/tableDesigner";
import { DesignerChangesPreviewButton } from "./designerChangesPreviewButton";
import { getLocString } from "../../common/locConstants";

const useStyles = makeStyles({
	separator: {
		...shorthands.margin('0px', '-20px', '0px', '0px'),
		...shorthands.padding('0px'),
		fontSize: '5px'
	}
});

export const DesignerPageRibbon = () => {
	const designerContext = useContext(TableDesignerContext);
	const classes = useStyles();
	if (!designerContext) {
		return null;
	}

	return (
		<div>
			<Toolbar size="small">
				<ToolbarButton
					aria-label={getLocString('GENERATE_SCRIPT')}
					title={getLocString('GENERATE_SCRIPT')}
					icon={<DocumentChevronDoubleRegular />}
					onClick={
						() => {
							designerContext.provider.generateScript();
						}
					}
					disabled={(designerContext.state.issues?.length ?? 0) > 0}
				>
					{getLocString('GENERATE_SCRIPT')} {designerContext.state.apiState?.generateScriptState === LoadState.Loading && <Spinner style={{
						marginLeft: '5px'
					}} size='extra-small' />}
				</ToolbarButton>
				<ToolbarButton
					aria-label={getLocString('SCRIPT_AS_CREATE')}
					title={getLocString('SCRIPT_AS_CREATE')}
					icon={<DocumentChevronDoubleRegular />}
					onClick={() => {
						designerContext.provider.scriptAsCreate();
					}}
				>
					{getLocString('SCRIPT_AS_CREATE')}
				</ToolbarButton>
				<DesignerChangesPreviewButton />
			</Toolbar>
			<Divider className={classes.separator} />
		</div>
	)
}