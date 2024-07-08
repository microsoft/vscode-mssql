/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton } from "@fluentui/react-toolbar";
import { DocumentChevronDoubleRegular } from "@fluentui/react-icons";
import { Divider, Spinner, makeStyles, shorthands } from "@fluentui/react-components";
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { LoadState } from "./tableDesignerInterfaces";
import { DesignerChangesPreviewButton } from "./designerChangesPreviewButton";

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
					aria-label="Generate Script"
					title="Generate"
					icon={<DocumentChevronDoubleRegular />}
					onClick={
						() => {
							designerContext.provider.generateScript();
						}
					}
					disabled={(designerContext.state.issues?.length ?? 0) > 0}
				>
					Generate Script {designerContext.state.apiState?.generateScriptState === LoadState.Loading && <Spinner style={{
						marginLeft: '5px'
					}} size='extra-small' />}
				</ToolbarButton>
				<ToolbarButton
					icon={<DocumentChevronDoubleRegular />}
					onClick={() => {
						designerContext.provider.scriptAsCreate();
					}}
				>
					Script As Create
				</ToolbarButton>
				<DesignerChangesPreviewButton />
			</Toolbar>
			<Divider className={classes.separator} />
		</div>
	)
}