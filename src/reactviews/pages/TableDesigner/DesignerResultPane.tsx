/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, CounterBadge, Divider, Link, Tab, TabList, Table, TableBody, TableCell, TableColumnDefinition, TableColumnSizingOptions, TableHeader, TableHeaderCell, TableRow, Theme, createTableColumn, makeStyles, shorthands, teamsHighContrastTheme, useTableColumnSizing_unstable, useTableFeatures, webDarkTheme } from "@fluentui/react-components";
import { useContext, useState } from "react";
import { OpenFilled } from "@fluentui/react-icons";
import Editor from '@monaco-editor/react';
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { DesignerIssue, DesignerResultPaneTabs, InputBoxProperties } from "./tableDesignerInterfaces";
import { VscodeWebviewContext } from "../../common/vscodeWebViewProvider";
import { ErrorCircleFilled, WarningFilled, InfoFilled } from "@fluentui/react-icons";

const useStyles = makeStyles({
	root: {
		width: '100%',
		height: '100%',
		display: 'flex',
		flexDirection: 'column',
	},
	ribbon: {
		width: '100%',
		display: 'flex',
		flexDirection: 'row',
		'> *': {
			marginRight: '10px'
		},
	},
	designerResultPaneTabs: {
		flex: 1,
	},
	tabContent: {
		...shorthands.flex(1),
		width: '100%',
		height: '100%',
		display: 'flex',
		...shorthands.overflow('auto'),
	},
	designerResultPaneScript: {
		width: '100%',
		height: '100%',
		position: 'relative',
	},
	designerResultPaneScriptOpenButton: {
		position: 'absolute',
		top: '0px',
		right: '0px',
	},
	issuesContainer: {
		width: '100%',
		height: '100%',
		flexDirection: 'column',
		'> *': {
			marginBottom: '10px'
		},

	},
	issuesRows: {
		flexDirection: 'row',
		...shorthands.padding('10px'),
		'> *': {
			marginRight: '10px'
		},
	}
});

export const DesignerResultPane = () => {
	const classes = useStyles();
	const state = useContext(TableDesignerContext);
	const webViewState = useContext(VscodeWebviewContext);
	const metadata = state?.state;

	const getVscodeTheme = (theme: Theme) => {

		switch (theme) {
			case webDarkTheme:
				return 'vs-dark';
			case teamsHighContrastTheme:
				return 'hc-black';
			default:
				return 'light';
		}
	}

	const columnsDef: TableColumnDefinition<DesignerIssue>[] = [
		createTableColumn({
			columnId: 'severity',
			renderHeaderCell: () => <>Severity</>
		}),
		createTableColumn({
			columnId: 'description',
			renderHeaderCell: () => <>Description</>
		}),
		createTableColumn({
			columnId: 'propertyPath',
			renderHeaderCell: () => <></>
		}),
	];
	const [columns] = useState<TableColumnDefinition<DesignerIssue>[]>(columnsDef);
	const items = metadata?.issues ?? [];

	const sizingOptions: TableColumnSizingOptions = {
		'severity': {
			minWidth: 50,
			idealWidth: 50,
			defaultWidth: 50
		},
		'description': {
			minWidth: 500,
			idealWidth: 500,
			defaultWidth: 500
		},
		'propertyPath': {
			minWidth: 100,
			idealWidth: 100,
			defaultWidth: 100
		}
	};

	const [columnSizingOption] = useState<TableColumnSizingOptions>(sizingOptions);
	const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
		{
			columns,
			items: items
		},
		[useTableColumnSizing_unstable({ columnSizingOptions: columnSizingOption })]
	);
	const rows = getRows();

	if (!metadata) {
		return null;
	}
	return <div className={classes.root}>
		<div className={classes.ribbon}>
			<TabList
				size='medium'
				selectedValue={metadata.tabStates!.resultPaneTab}
				onTabSelect={(_event, data) => {
					state.provider.setResultTab(data.value as string)
				}}
				className={classes.designerResultPaneTabs}
			>
				<Tab value={DesignerResultPaneTabs.Script} key={DesignerResultPaneTabs.Script}>
					Script
				</Tab>
				<Tab value={DesignerResultPaneTabs.Issues} key={DesignerResultPaneTabs.Issues}
					disabled={!metadata.issues || metadata.issues.length === 0}
				>
					Issues {metadata.issues && <CounterBadge style={{
						marginLeft: '5px',
						marginTop: '-10px'
					}} count={metadata.issues?.length} size='small' />}
				</Tab>
			</TabList>
			{
				metadata.tabStates!.resultPaneTab == DesignerResultPaneTabs.Script &&
				<Divider vertical style={{
					flex: '0'
				}} />
			}

			{
				metadata.tabStates!.resultPaneTab == DesignerResultPaneTabs.Script &&
				<Button appearance="transparent" icon={<OpenFilled />} onClick={() => state.provider.scriptAsCreate()} title='Open in new tab'></Button>
			}
		</div>
		<div className={classes.tabContent}>
			{metadata.tabStates!.resultPaneTab === DesignerResultPaneTabs.Script &&
				<div className={classes.designerResultPaneScript}>
					<Editor
						height={'100%'}
						width={'100%'}
						language="sql"
						theme={getVscodeTheme(webViewState!.theme!)}
						value={(metadata?.model!['script'] as InputBoxProperties).value ?? ''}
					>

					</Editor>
				</div>
			}
			{metadata.tabStates!.resultPaneTab === DesignerResultPaneTabs.Issues && <div className={classes.issuesContainer}>
				<Table size="small"
					{...columnSizing_unstable.getTableProps()}
					ref={tableRef}
				>
					<TableHeader>
						<TableRow>
							{
								columnsDef.map((column) => {
									return <TableHeaderCell
										{...columnSizing_unstable.getTableHeaderCellProps(column.columnId)}
										key={column.columnId}>
										{column.renderHeaderCell()}
									</TableHeaderCell>
								})
							}
						</TableRow>
					</TableHeader>
					<TableBody>
						{
							rows.map((row, index) => {
								return <TableRow key={index}>
									<TableCell
										{...columnSizing_unstable.getTableCellProps('severity')}
									>
										{row.item.severity === 'error' && <ErrorCircleFilled style={{ marginTop: '5px' }} fontSize={20} color="red" />}
										{row.item.severity === 'warning' && <WarningFilled style={{ marginTop: '5px' }} fontSize={20} color="yellow" />}
										{row.item.severity === 'information' && <InfoFilled style={{ marginTop: '5px' }} fontSize={20} color="blue" />}
									</TableCell>
									<TableCell
										{...columnSizing_unstable.getTableCellProps('description')}
									>{row.item.description} {row.item.propertyPath}</TableCell>
									<TableCell
										{...columnSizing_unstable.getTableCellProps('propertyPath')}
									><Link>
											Go there
										</Link></TableCell>
								</TableRow>
							})
						}
					</TableBody>
					{/* {metadata.issues?.map((i, index) => {
						return <div className={classes.issuesRows}>
							<Text size={300}>{(index + 1)}.</Text>
							<Text size={300}>{i.description} : {i.propertyPath?.join('.')}</Text>
							<Link onClick={() => {
								console.log('Go there');
								//designerContext.goToProperty(i.propertyPath!);
							}}>
								Go there
							</Link>
							{i.moreInfoLink && <Link href={i.moreInfoLink} target="_blank">More info</Link>}
						</div>
					})} */}
				</Table>
			</div>
			}
		</div>
	</div>
}