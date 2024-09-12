/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Divider, Link, Tab, TabList, Table, TableBody, TableCell, TableColumnDefinition, TableColumnSizingOptions, TableRow, Theme, createTableColumn, makeStyles, shorthands, teamsHighContrastTheme, useTableColumnSizing_unstable, useTableFeatures, webDarkTheme } from "@fluentui/react-components";
import { useContext, useRef, useState } from "react";
import { OpenFilled } from "@fluentui/react-icons";
import { QueryResultContext } from "./queryResultStateProvider";
import * as qr from '../../../sharedInterfaces/queryResult';
import { useVscodeWebview } from '../../common/vscodeWebViewProvider';
import SlickGrid, { SlickGridHandle } from "./slickgrid";

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
	queryResultPaneTabs: {
		flex: 1,
	},
	tabContent: {
		...shorthands.flex(1),
		width: '100%',
		height: '100%',
		display: 'flex',
		...shorthands.overflow('auto'),
	},
	queryResultContainer: {
		width: '100%',
		height: '100%',
		position: 'relative',
	},
	queryResultPaneOpenButton: {
		position: 'absolute',
		top: '0px',
		right: '0px',
	},
	messagesContainer: {
		width: '100%',
		height: '100%',
		flexDirection: 'column',
		'> *': {
			marginBottom: '10px'
		},

	},
	messagesRows: {
		flexDirection: 'row',
		...shorthands.padding('10px'),
		'> *': {
			marginRight: '10px'
		},
	}
});

export const QueryResultPane = () => {
	const classes = useStyles();
	const state = useContext(QueryResultContext);
	const webViewState = useVscodeWebview<qr.QueryResultWebViewState, qr.QueryResultReducers>();
	webViewState;
	var metadata = state?.state;

	const getVscodeTheme = (theme: Theme) => {

		switch (theme) {
			case webDarkTheme:
				return 'vs-dark';
			case teamsHighContrastTheme:
				return 'hc-black';
			default:
				return 'light';
		}
	};

	getVscodeTheme;

	const columnsDef: TableColumnDefinition<qr.IMessage>[] = [
		createTableColumn({
			columnId: 'time',
			renderHeaderCell: () => <>Timestamp</>
		}),
		createTableColumn({
			columnId: 'message',
			renderHeaderCell: () => <>Message</>
		}),
	];
	const [columns] = useState<TableColumnDefinition<qr.IMessage>[]>(columnsDef);
	const items = metadata?.messages ?? [];

	const sizingOptions: TableColumnSizingOptions = {
		'time': {
			minWidth: 50,
			idealWidth: 50,
			defaultWidth: 50
		},
		'message': {
			minWidth: 500,
			idealWidth: 500,
			defaultWidth: 500
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

	const gridRef = useRef<SlickGridHandle>(null);

	return <div className={classes.root}>
		<div className={classes.ribbon}>
			<TabList
				size='medium'
				selectedValue={metadata.tabStates!.resultPaneTab}
				onTabSelect={(_event, data) => {
					state?.provider.setResultTab(data.value as qr.QueryResultPaneTabs);
				}}
				className={classes.queryResultPaneTabs}
			>
				<Tab value={qr.QueryResultPaneTabs.Results} key={qr.QueryResultPaneTabs.Results}>
					Results
				</Tab>
				<Tab value={qr.QueryResultPaneTabs.Messages} key={qr.QueryResultPaneTabs.Messages}
				>
					Messages
				</Tab>
			</TabList>
			{
				metadata.tabStates!.resultPaneTab == qr.QueryResultPaneTabs.Results &&
				<Divider vertical style={{
					flex: '0'
				}} />
			}

			{
				<Button appearance="transparent" icon={<OpenFilled />} onClick={async () => {
					console.log('todo: open in new tab');
					// gridRef.current.refreshGrid();
				}} title='Open in new tab'></Button>
			}
		</div>
		<div className={classes.tabContent}>
			{metadata.tabStates!.resultPaneTab === qr.QueryResultPaneTabs.Results &&
				<div id={'grid-parent'} className={classes.queryResultContainer}>
					<SlickGrid test={'fdas'} x={1} loadFunc={(offset: number, count: number): Thenable<any[]> => {
						return webViewState.extensionRpc.call('getRows', {
							uri: metadata.uri,
							batchId: metadata.resultSetSummary.batchId,
							resultId: metadata.resultSetSummary.id,
							rowStart: offset,
							numberOfRows: count
						}).then(response => {
							console.log('HAIDEBUG response' + JSON.stringify(response));
							if (!response) {
								return [];
							}
							let r = response as qr.ResultSetSubset;
							return r.rows.map(r => {
								let dataWithSchema = {};
								// skip the first column since its a number column
								for (let i = 1; i < metadata.resultSetSummary.columnInfo.length + 1; i++) {
									const displayValue = r[i - 1].displayValue ?? '';
									const ariaLabel = (displayValue);
									dataWithSchema[(i - 1).toString()] = {
										displayValue: displayValue,
										ariaLabel: ariaLabel,
										isNull: r[i - 1].isNull,
										invariantCultureDisplayValue: displayValue
									};
								}
								return dataWithSchema;
							});
						});

					}} ref={gridRef} resultSetSummary={metadata.resultSetSummary} />
				</div>
			}
			{metadata.tabStates!.resultPaneTab === qr.QueryResultPaneTabs.Messages && <div className={classes.messagesContainer}>
				<Table size="small"
					as="table"
					{...columnSizing_unstable.getTableProps()}
					ref={tableRef}
				>
					{/* <TableHeader>
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
					</TableHeader> */}
					<TableBody>
						{
							rows.map((row, index) => {
								return <TableRow key={index}>
									<TableCell
										{...columnSizing_unstable.getTableCellProps('time')}
									>{row.item.time}</TableCell>
									<TableCell
										{...columnSizing_unstable.getTableCellProps('message')}
									>{row.item.message}
										{row.item.link?.text && row.item.selection && (
											<>{' '}<Link onClick={(e) => { console.log('TODO open link'); }}>{row.item?.link?.text}</Link></>
										)}
									</TableCell>
								</TableRow>;
							})
						}
					</TableBody>
				</Table>
			</div>
			}
		</div>
	</div>
}