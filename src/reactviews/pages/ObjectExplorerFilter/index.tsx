/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Body1Strong, Button, createTableColumn, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Input, makeStyles, Option, Table, TableBody, TableCell, TableColumnDefinition, TableColumnSizingOptions, TableHeader, TableHeaderCell, TableRow, Text, Tooltip, useTableColumnSizing_unstable, useTableFeatures } from "@fluentui/react-components";
import { useContext, useState } from "react";
import { ObjectExplorerFilterContext } from "./ObjectExplorerFilterStateProvider";
import * as vscodeMssql from 'vscode-mssql';
import { EraserRegular } from "@fluentui/react-icons";
import { NodeFilterOperator, NodeFilterPropertyDataType } from "../../../sharedInterfaces/objectExplorerFilter";

export const useStyles = makeStyles({
	root: {
		flexDirection: 'column',
		display: 'flex',
		paddingTop: '10px',
		paddingLeft: '10px',
		'> *': {
			margin: '5px',
		}
	},
	inputs: {
		maxWidth: "150px",
		minWidth: "150px",
		width: "150px",
	},
	tableCell: {
		display: 'flex',
		flexDirection: 'column',
		'> *': {
			margin: '5px',
		}
	}
});

export const ObjectExplorerFilter = () => {
	const classes = useStyles();
	const [open] = useState(true);
	const provider = useContext(ObjectExplorerFilterContext);
	const [filters, setFilters] = useState<Record<string, vscodeMssql.NodeFilter>>(
		provider?.state?.filterProperties?.reduce((acc, filter) => {
			const existingFilter = provider?.state?.existingFilters?.find(f => f.name === filter.name);
			acc[filter.name] = {
				name: filter.name,
				value: existingFilter?.value ?? undefined,
				operator: existingFilter?.operator ?? undefined!
			};
			return acc;
		}, {} as Record<string, vscodeMssql.NodeFilter>) ?? {});

	function getFilterValue(name: string): string | number | boolean | string[] | number[] | undefined {
		return filters[name]?.value;
	}

	function getFilterOperator(name: string): string | undefined {
		return  getFilterOperatorString(filters[name]?.operator);
	}


	const columnsDef: TableColumnDefinition<vscodeMssql.NodeFilterProperty>[] =
		[
			createTableColumn(
				{
					columnId: 'property',
					renderHeaderCell: () => <>Property</>,
					renderCell: (item) => {
						return <Text size={200}>{item.displayName}</Text>;
					}
				}
			),
			createTableColumn(
				{
					columnId: 'operator',
					renderHeaderCell: () => <>Operator</>,
					renderCell: (item) => {
						const datatype = item.type;
						let options: string[] = [];
						switch (datatype) {
							case NodeFilterPropertyDataType.Boolean:
								options = [
									EQUALS,
									NOT_EQUALS
								];
								break;
							case NodeFilterPropertyDataType.String:
								options = [
									CONTAINS,
									NOT_CONTAINS,
									STARTS_WITH,
									NOT_STARTS_WITH,
									ENDS_WITH,
									NOT_ENDS_WITH,
									EQUALS,
									NOT_EQUALS
								];
								break;
							case NodeFilterPropertyDataType.Number:
								options = [
									EQUALS,
									NOT_EQUALS,
									LESS_THAN,
									LESS_THAN_OR_EQUALS,
									GREATER_THAN,
									GREATER_THAN_OR_EQUALS,
									BETWEEN,
									NOT_BETWEEN
								];
								break;
							case NodeFilterPropertyDataType.Date:
								options = [
									EQUALS,
									NOT_EQUALS,
									LESS_THAN,
									LESS_THAN_OR_EQUALS,
									GREATER_THAN,
									GREATER_THAN_OR_EQUALS,
									BETWEEN,
									NOT_BETWEEN
								];
								break;
							case NodeFilterPropertyDataType.Choice:
								options = [
									EQUALS,
									NOT_EQUALS
								];
								break;
						}

						return <div className={classes.tableCell} >
							<Dropdown style={{
								maxWidth: '150px',
								width: '150px',
								minWidth: '150px',
							}} size="small" defaultValue={getFilterOperator(item.name) ?? options[0]} value={getFilterOperator(item.name)}

							onOptionSelect={(_e, d) => {
								filters[item.name].operator = getFilterOperatorEnum(d.optionValue!);
								setFilters(filters);
							}}
							>
								{options.map((option) => {
									return <Option key={option} value={option}>{option}</Option>;
								})}
							</Dropdown>
							{
								(getFilterOperator(item.name) === BETWEEN || getFilterOperator(item.name) === NOT_BETWEEN) &&
								<Text size={200}>And</Text>
							}
						</div>;
					}
				}
			),
			createTableColumn(
				{
					columnId: 'value',
					renderHeaderCell: () => <>Value</>,
					renderCell: (item) => {
						switch (item.type) {
							case NodeFilterPropertyDataType.Boolean:
								return <Dropdown size="small" className={classes.inputs} value={getFilterValue(item.name) as string} onOptionSelect={(_e, d) => {
									filters[item.name].value = d.optionValue === 'true';
									setFilters(filters);
								}} >
									<Option value="true">True</Option>
									<Option value="false">False</Option>
								</Dropdown>;
							case NodeFilterPropertyDataType.String:
								return <Input size="small" className={classes.inputs} value={getFilterValue(item.name) as string} onChange={(_e, d) => {
									filters[item.name].value = d.value;
									setFilters(filters);
								}} />;
							case NodeFilterPropertyDataType.Number:
								return <Input size="small" type="number" className={classes.inputs} value={getFilterValue(item.name) as string} onChange={(_e, d) => {
									filters[item.name].value = d.value;
									setFilters(filters);
								}} />;
							case NodeFilterPropertyDataType.Date:
								return <Input size="small" type="date" className={classes.inputs} value={getFilterValue(item.name) as string} onChange={(_e, d) => {
									filters[item.name].value = d.value;
									setFilters(filters);
								}} />;
							case NodeFilterPropertyDataType.Choice:
								return <Dropdown size="small" className={classes.inputs} value={getFilterValue(item.name) as string} onOptionSelect={(_e, d) => {
									filters[item.name].value = d.optionValue;
									setFilters(filters);
								}}>
									{(item as vscodeMssql.NodeFilterChoiceProperty).choices.map((choice) => {
										return <Option key={choice.value!} value={choice.value}>{choice.displayName ?? ''}</Option>;
									}
									)}
								</Dropdown>;
							default:
								return <Input size="small" className={classes.inputs} />;
						}
					}
				}
			),
			createTableColumn(
				{
					columnId: 'clear',
					renderHeaderCell: () => <>Clear</>,
					renderCell: (_item) => {
						return <Tooltip content="Clear" relationship="label">
							<Button size="small" icon={<EraserRegular />} />
						</Tooltip>;
					}
				}
			)
		];

	const [columns] = useState<TableColumnDefinition<vscodeMssql.NodeFilterProperty>[]>(columnsDef);


	const sizingOptions: TableColumnSizingOptions = {
		'property': {
			minWidth: 100,
			idealWidth: 130,
			defaultWidth: 130
		},
		'operator': {
			minWidth: 100,
			idealWidth: 140,
			defaultWidth: 140
		},
		'value': {
			minWidth: 100,
			idealWidth: 150,
			defaultWidth: 150
		},
		'clear': {
			minWidth: 20,
			idealWidth: 20,
			defaultWidth: 20
		}
	};

	const [columnSizingOptions] = useState<TableColumnSizingOptions>(sizingOptions);
	const items = provider?.state?.filterProperties ?? [];

	const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
		{
			columns,
			items
		},
		[useTableColumnSizing_unstable({ columnSizingOptions })]
	);
	const rows = getRows();
	if (!provider) {
		return null;
	}
	return (
		<div className={classes.root}>

			<Dialog

				// this controls the dialog open state
				open={open}
			>
				<DialogSurface style={{ margin: '0px auto', overflow:'scroll' }}>
					<DialogBody style={{ minWidth:'560px', width:'560px', maxWidth:'560px', overflow: 'scroll' }}>
						<DialogTitle>Filter Settings</DialogTitle>
						<DialogContent>
							<Body1Strong>Path: {provider?.state?.nodePath}</Body1Strong>
							<Table
								as="table"
								size="small"
								{...columnSizing_unstable.getTableProps()}
								ref={tableRef}
							>
								<TableHeader>
									<TableRow>
										{
											columns.map(column => {
												return <TableHeaderCell
													key={column.columnId}
													{...columnSizing_unstable.getTableHeaderCellProps(column.columnId)}
												>
													{column.renderHeaderCell()}
												</TableHeaderCell>;
											})
										}
									</TableRow>
								</TableHeader>
								<TableBody>
									{
										rows.map((row, index) => {
											return <TableRow key={`row${index}`}>
												{
													columnsDef.map(column => {
														return <TableCell
															key={column.columnId}
															{...columnSizing_unstable.getTableHeaderCellProps(column.columnId)}
														>
															{column.renderCell(row.item)}
														</TableCell>;
													})
												}
											</TableRow>;
										})
									}
								</TableBody>
							</Table>
						</DialogContent>

						<DialogActions>
							<Button appearance="secondary">Clear All</Button>
							<Button appearance="secondary" onClick={() => {
								provider.cancel();
							}}>Close</Button>
							<Button appearance="primary" onClick={() => {
								provider.submit([]);
							}}>OK</Button>

						</DialogActions>
					</DialogBody>
				</DialogSurface>
			</Dialog>
		</div>
	);
};

function getFilterOperatorString(operator: NodeFilterOperator | undefined): string | undefined {
	if(operator === undefined) {
		return undefined;
	}
	switch (operator) {
		case NodeFilterOperator.Contains:
			return CONTAINS;
		case NodeFilterOperator.NotContains:
			return NOT_CONTAINS;
		case NodeFilterOperator.StartsWith:
			return STARTS_WITH;
		case NodeFilterOperator.NotStartsWith:
			return NOT_STARTS_WITH;
		case NodeFilterOperator.EndsWith:
			return ENDS_WITH;
		case NodeFilterOperator.NotEndsWith:
			return NOT_ENDS_WITH;
		case NodeFilterOperator.Equals:
			return EQUALS;
		case NodeFilterOperator.NotEquals:
			return NOT_EQUALS;
		case NodeFilterOperator.LessThan:
			return LESS_THAN;
		case NodeFilterOperator.LessThanOrEquals:
			return LESS_THAN_OR_EQUALS;
		case NodeFilterOperator.GreaterThan:
			return GREATER_THAN;
		case NodeFilterOperator.GreaterThanOrEquals:
			return GREATER_THAN_OR_EQUALS;
		case NodeFilterOperator.Between:
			return BETWEEN;
		case NodeFilterOperator.NotBetween:
			return NOT_BETWEEN;
		default:
			return '';
	}
}

function getFilterOperatorEnum(operator: string): NodeFilterOperator {
	switch (operator) {
		case CONTAINS:
			return NodeFilterOperator.Contains;
		case NOT_CONTAINS:
			return NodeFilterOperator.NotContains;
		case STARTS_WITH:
			return NodeFilterOperator.StartsWith;
		case NOT_STARTS_WITH:
			return NodeFilterOperator.NotStartsWith;
		case ENDS_WITH:
			return NodeFilterOperator.EndsWith;
		case NOT_ENDS_WITH:
			return NodeFilterOperator.NotEndsWith;
		case EQUALS:
			return NodeFilterOperator.Equals;
		case NOT_EQUALS:
			return NodeFilterOperator.NotEquals;
		case LESS_THAN:
			return NodeFilterOperator.LessThan;
		case LESS_THAN_OR_EQUALS:
			return NodeFilterOperator.LessThanOrEquals;
		case GREATER_THAN:
			return NodeFilterOperator.GreaterThan;
		case GREATER_THAN_OR_EQUALS:
			return NodeFilterOperator.GreaterThanOrEquals;
		case BETWEEN:
			return NodeFilterOperator.Between;
		case NOT_BETWEEN:
			return NodeFilterOperator.NotBetween;
		default:
			return NodeFilterOperator.Equals;
	}
}

const CONTAINS = 'Contains';
const NOT_CONTAINS = 'Not Contains';
const STARTS_WITH = 'Starts With';
const NOT_STARTS_WITH = 'Not Starts With';
const ENDS_WITH = 'Ends With';
const NOT_ENDS_WITH = 'Not Ends With';
const EQUALS = 'Equals';
const NOT_EQUALS = 'Not Equals';
const LESS_THAN = 'Less Than';
const LESS_THAN_OR_EQUALS = 'Less Than Or Equals';
const GREATER_THAN = 'Greater Than';
const GREATER_THAN_OR_EQUALS = 'Greater Than Or Equals';
const BETWEEN = 'Between';
const NOT_BETWEEN = 'Not Between';