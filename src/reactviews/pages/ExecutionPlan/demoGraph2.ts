export const data = {
    "label": "SELECT",
    "tooltipTitle": "SELECT",
    "rowCountDisplayString": "",
    "costDisplayString": "0%",
    "id": "element-1",
    "icon": "result",
    "metrics": [
        {
            "name": "Statement",
            "value": "select * from sys.objects",
            "isLongString": true
        },
        {
            "name": "Cached plan size",
            "value": "120 KB",
            "isLongString": false
        },
        {
            "name": "Estimated Number of Rows Per Execution",
            "value": "2575",
            "isLongString": false
        },
        {
            "name": "Estimated Number of Rows for All Executions",
            "value": "0",
            "isLongString": false
        }
    ],
    "badges": [],
    "edges": [
        {
            "id": "element-QKKI7BvZMbSsg1m1WAVndmveD2gzYKry",
            "metrics": [
                {
                    "name": "Estimated Number of Rows Per Execution",
                    "value": "2575",
                    "isLongString": false
                },
                {
                    "name": "Estimated Number of Rows for All Executions",
                    "value": "2575",
                    "isLongString": false
                },
                {
                    "name": "Estimated Row Size",
                    "value": "237 B",
                    "isLongString": false
                },
                {
                    "name": "Estimated Data Size",
                    "value": "596 KB",
                    "isLongString": false
                }
            ],
            "weight": 3.0580829250329074,
            "label": ""
        }
    ],
    "children": [
        {
            "label": "Hash Match\n(Right Outer Join)",
            "tooltipTitle": "Hash Match\n(Right Outer Join)",
            "rowCountDisplayString": "2575",
            "costDisplayString": "34%",
            "id": "element-2",
            "icon": "hashMatch",
            "metrics": [
                {
                    "name": "Physical Operation",
                    "value": "Hash Match",
                    "isLongString": false
                },
                {
                    "name": "Logical Operation",
                    "value": "Right Outer Join",
                    "isLongString": false
                },
                {
                    "name": "Estimated Execution Mode",
                    "value": "Row",
                    "isLongString": false
                },
                {
                    "name": "Estimated I/O Cost",
                    "value": "0",
                    "isLongString": false
                },
                {
                    "name": "Estimated CPU Cost",
                    "value": "0.0391321",
                    "isLongString": false
                },
                {
                    "name": "Estimated Number of Executions",
                    "value": "1",
                    "isLongString": false
                },
                {
                    "name": "Estimated Number of Rows Per Execution",
                    "value": "2575",
                    "isLongString": false
                },
                {
                    "name": "Estimated Number of Rows for All Executions",
                    "value": "2575",
                    "isLongString": false
                },
                {
                    "name": "Estimated Row Size",
                    "value": "237 B",
                    "isLongString": false
                },
                {
                    "name": "Output List",
                    "value": "[master].[sys].[sysschobjs].id, [master].[sys].[sysschobjs].name, [master].[sys].[sysschobjs].nsid, [master].[sys].[sysschobjs].pid, [master].[sys].[sysschobjs].created, [master].[sys].[sysschobjs].modified, [master].[sys].[syssingleobjrefs].indepid, [mssqlsystemresource].[sys].[syspalnames].name, Expr1003, Expr1004, Expr1007, Expr1008",
                    "isLongString": true
                },
                {
                    "name": "Hash Keys Probe",
                    "value": "[master].[sys].[sysschobjs].type",
                    "isLongString": true
                },
                {
                    "name": "Probe Residual",
                    "value": "[mssqlsystemresource].[sys].[syspalnames].[value] as [n].[value]=[master].[sys].[sysschobjs].[type] as [o].[type]",
                    "isLongString": true
                },
                {
                    "name": "Node ID",
                    "value": "0",
                    "isLongString": false
                }
            ],
            "badges": [],
            "edges": [
                {
                    "id": "element-fZN9jmC42LLox5ZauSnvWdssOR6jNmjq",
                    "metrics": [
                        {
                            "name": "Estimated Number of Rows Per Execution",
                            "value": "32",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Number of Rows for All Executions",
                            "value": "32",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Row Size",
                            "value": "74 B",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Data Size",
                            "value": "2368 B",
                            "isLongString": false
                        }
                    ],
                    "weight": 1.6288624837399295,
                    "label": ""
                },
                {
                    "id": "element-Rah9ooyUPpqqtvS5hNBn5TAGtevuO0tu",
                    "metrics": [
                        {
                            "name": "Estimated Number of Rows Per Execution",
                            "value": "2575",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Number of Rows for All Executions",
                            "value": "2575",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Row Size",
                            "value": "177 B",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Data Size",
                            "value": "445 KB",
                            "isLongString": false
                        }
                    ],
                    "weight": 3.0580829250329074,
                    "label": ""
                }
            ],
            "children": [
                {
                    "label": "Clustered Index Seek\n[syspalnames].[cl] [n]",
                    "tooltipTitle": "Clustered Index Seek\n[syspalnames].[cl] [n]",
                    "rowCountDisplayString": "32",
                    "costDisplayString": "3%",
                    "id": "element-3",
                    "icon": "clusteredIndexSeek",
                    "metrics": [
                        {
                            "name": "Physical Operation",
                            "value": "Clustered Index Seek",
                            "isLongString": false
                        },
                        {
                            "name": "Logical Operation",
                            "value": "Clustered Index Seek",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Execution Mode",
                            "value": "Row",
                            "isLongString": false
                        },
                        {
                            "name": "Storage",
                            "value": "RowStore",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated I/O Cost",
                            "value": "0.003125",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated CPU Cost",
                            "value": "0.0001922",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Number of Executions",
                            "value": "1",
                            "isLongString": false
                        },
                        {
                            "name": "Object",
                            "value": "[mssqlsystemresource].[sys].[syspalnames].[cl] [n]",
                            "isLongString": true
                        },
                        {
                            "name": "Estimated Number of Rows Per Execution",
                            "value": "32",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Number of Rows to be Read",
                            "value": "32",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Number of Rows for All Executions",
                            "value": "32",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Row Size",
                            "value": "74 B",
                            "isLongString": false
                        },
                        {
                            "name": "Output List",
                            "value": "[mssqlsystemresource].[sys].[syspalnames].value, [mssqlsystemresource].[sys].[syspalnames].name",
                            "isLongString": true
                        },
                        {
                            "name": "Ordered",
                            "value": "True",
                            "isLongString": false
                        },
                        {
                            "name": "Seek Predicates",
                            "value": "Seek Keys[1]: Prefix: [mssqlsystemresource].[sys].[syspalnames].class = Scalar Operator('OBTY')",
                            "isLongString": true
                        },
                        {
                            "name": "Node ID",
                            "value": "1",
                            "isLongString": false
                        }
                    ],
                    "badges": [],
                    "edges": [],
                    "children": [],
                    "description": "Scanning a particular range of rows from a clustered index.",
                    "cost": 0.0033172,
                    "subTreeCost": 0.0033172,
                    "relativeCost": 0.028714379695993907,
                    "elapsedTimeInMs": null,
                    "costMetrics": [
                        {
                            "name": "EstimateRowsAllExecs",
                            "value": "32"
                        },
                        {
                            "name": "EstimatedRowsRead",
                            "value": "32"
                        }
                    ]
                },
                {
                    "label": "Hash Match\n(Right Outer Join)",
                    "tooltipTitle": "Hash Match\n(Right Outer Join)",
                    "rowCountDisplayString": "2575",
                    "costDisplayString": "27%",
                    "id": "element-4",
                    "icon": "hashMatch",
                    "metrics": [
                        {
                            "name": "Physical Operation",
                            "value": "Hash Match",
                            "isLongString": false
                        },
                        {
                            "name": "Logical Operation",
                            "value": "Right Outer Join",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Execution Mode",
                            "value": "Row",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated I/O Cost",
                            "value": "0",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated CPU Cost",
                            "value": "0.0315147",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Number of Executions",
                            "value": "1",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Number of Rows Per Execution",
                            "value": "2575",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Number of Rows for All Executions",
                            "value": "2575",
                            "isLongString": false
                        },
                        {
                            "name": "Estimated Row Size",
                            "value": "177 B",
                            "isLongString": false
                        },
                        {
                            "name": "Output List",
                            "value": "[master].[sys].[sysschobjs].id, [master].[sys].[sysschobjs].name, [master].[sys].[sysschobjs].nsid, [master].[sys].[sysschobjs].type, [master].[sys].[sysschobjs].pid, [master].[sys].[sysschobjs].created, [master].[sys].[sysschobjs].modified, [master].[sys].[syssingleobjrefs].indepid, Expr1003, Expr1004, Expr1007, Expr1008",
                            "isLongString": true
                        },
                        {
                            "name": "Hash Keys Probe",
                            "value": "[master].[sys].[sysschobjs].id",
                            "isLongString": true
                        },
                        {
                            "name": "Node ID",
                            "value": "2",
                            "isLongString": false
                        }
                    ],
                    "badges": [],
                    "edges": [
                        {
                            "id": "element-G8EvsZcGILoo1yaLcfRJgzDw8Viaygmf",
                            "metrics": [
                                {
                                    "name": "Estimated Number of Rows Per Execution",
                                    "value": "1",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Number of Rows for All Executions",
                                    "value": "1",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Row Size",
                                    "value": "20 B",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Data Size",
                                    "value": "20 B",
                                    "isLongString": false
                                }
                            ],
                            "weight": 0.5,
                            "label": ""
                        },
                        {
                            "id": "element-xk7zg71rS3Yp7gfYaf460xqgMdYxinxG",
                            "metrics": [
                                {
                                    "name": "Estimated Number of Rows Per Execution",
                                    "value": "2575",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Number of Rows for All Executions",
                                    "value": "2575",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Row Size",
                                    "value": "173 B",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Data Size",
                                    "value": "435 KB",
                                    "isLongString": false
                                }
                            ],
                            "weight": 3.0580829250329074,
                            "label": ""
                        }
                    ],
                    "children": [
                        {
                            "label": "Index Scan\n[syssingleobjrefs].[nc1] [r]",
                            "tooltipTitle": "Index Scan\n[syssingleobjrefs].[nc1] [r]",
                            "rowCountDisplayString": "1",
                            "costDisplayString": "3%",
                            "id": "element-5",
                            "icon": "indexScan",
                            "metrics": [
                                {
                                    "name": "Physical Operation",
                                    "value": "Index Scan",
                                    "isLongString": false
                                },
                                {
                                    "name": "Logical Operation",
                                    "value": "Index Scan",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Execution Mode",
                                    "value": "Row",
                                    "isLongString": false
                                },
                                {
                                    "name": "Storage",
                                    "value": "RowStore",
                                    "isLongString": false
                                },
                                {
                                    "name": "Predicate",
                                    "value": "[master].[sys].[syssingleobjrefs].[class] as [r].[class]=(97) AND [master].[sys].[syssingleobjrefs].[depsubid] as [r].[depsubid]=(0)",
                                    "isLongString": true
                                },
                                {
                                    "name": "Estimated I/O Cost",
                                    "value": "0.003125",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated CPU Cost",
                                    "value": "0.0003924",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Number of Executions",
                                    "value": "1",
                                    "isLongString": false
                                },
                                {
                                    "name": "Object",
                                    "value": "[master].[sys].[syssingleobjrefs].[nc1] [r]",
                                    "isLongString": true
                                },
                                {
                                    "name": "Estimated Number of Rows Per Execution",
                                    "value": "1",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Number of Rows to be Read",
                                    "value": "214",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Number of Rows for All Executions",
                                    "value": "1",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Row Size",
                                    "value": "20 B",
                                    "isLongString": false
                                },
                                {
                                    "name": "Output List",
                                    "value": "[master].[sys].[syssingleobjrefs].depid, [master].[sys].[syssingleobjrefs].indepid",
                                    "isLongString": true
                                },
                                {
                                    "name": "Ordered",
                                    "value": "False",
                                    "isLongString": false
                                },
                                {
                                    "name": "Node ID",
                                    "value": "3",
                                    "isLongString": false
                                }
                            ],
                            "badges": [],
                            "edges": [],
                            "children": [],
                            "description": "Scan a nonclustered index, entirely or only a range.",
                            "cost": 0.0035174,
                            "subTreeCost": 0.0035174,
                            "relativeCost": 0.030447352930992693,
                            "elapsedTimeInMs": null,
                            "costMetrics": [
                                {
                                    "name": "EstimateRowsAllExecs",
                                    "value": "1"
                                },
                                {
                                    "name": "EstimatedRowsRead",
                                    "value": "214"
                                }
                            ]
                        },
                        {
                            "label": "Filter",
                            "tooltipTitle": "Filter",
                            "rowCountDisplayString": "2575",
                            "costDisplayString": "4%",
                            "id": "element-6",
                            "icon": "filter",
                            "metrics": [
                                {
                                    "name": "Physical Operation",
                                    "value": "Filter",
                                    "isLongString": false
                                },
                                {
                                    "name": "Logical Operation",
                                    "value": "Filter",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Execution Mode",
                                    "value": "Row",
                                    "isLongString": false
                                },
                                {
                                    "name": "Predicate",
                                    "value": "has_access('CO',[master].[sys].[sysschobjs].[id] as [o].[id])=(1)",
                                    "isLongString": true
                                },
                                {
                                    "name": "Estimated I/O Cost",
                                    "value": "0",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated CPU Cost",
                                    "value": "0.0040685",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Number of Executions",
                                    "value": "1",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Number of Rows Per Execution",
                                    "value": "2575",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Number of Rows for All Executions",
                                    "value": "2575",
                                    "isLongString": false
                                },
                                {
                                    "name": "Estimated Row Size",
                                    "value": "173 B",
                                    "isLongString": false
                                },
                                {
                                    "name": "Output List",
                                    "value": "[master].[sys].[sysschobjs].id, [master].[sys].[sysschobjs].name, [master].[sys].[sysschobjs].nsid, [master].[sys].[sysschobjs].type, [master].[sys].[sysschobjs].pid, [master].[sys].[sysschobjs].created, [master].[sys].[sysschobjs].modified, Expr1003, Expr1004, Expr1007, Expr1008",
                                    "isLongString": true
                                },
                                {
                                    "name": "Node ID",
                                    "value": "4",
                                    "isLongString": false
                                }
                            ],
                            "badges": [],
                            "edges": [
                                {
                                    "id": "element-eMvvGUvjSwkWiTxGXS4xeGZLkSKt9EiU",
                                    "metrics": [
                                        {
                                            "name": "Estimated Number of Rows Per Execution",
                                            "value": "2575",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated Number of Rows for All Executions",
                                            "value": "2575",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated Row Size",
                                            "value": "175 B",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated Data Size",
                                            "value": "440 KB",
                                            "isLongString": false
                                        }
                                    ],
                                    "weight": 3.0580829250329074,
                                    "label": ""
                                }
                            ],
                            "children": [
                                {
                                    "label": "Compute Scalar",
                                    "tooltipTitle": "Compute Scalar",
                                    "rowCountDisplayString": "2575",
                                    "costDisplayString": "0%",
                                    "id": "element-7",
                                    "icon": "computeScalar",
                                    "metrics": [
                                        {
                                            "name": "Physical Operation",
                                            "value": "Compute Scalar",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Logical Operation",
                                            "value": "Compute Scalar",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated Execution Mode",
                                            "value": "Row",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated I/O Cost",
                                            "value": "0",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated CPU Cost",
                                            "value": "0.0002575",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated Number of Executions",
                                            "value": "1",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated Number of Rows Per Execution",
                                            "value": "2575",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated Number of Rows for All Executions",
                                            "value": "2575",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Estimated Row Size",
                                            "value": "175 B",
                                            "isLongString": false
                                        },
                                        {
                                            "name": "Output List",
                                            "value": "[master].[sys].[sysschobjs].id, [master].[sys].[sysschobjs].name, [master].[sys].[sysschobjs].nsid, [master].[sys].[sysschobjs].type, [master].[sys].[sysschobjs].pid, [master].[sys].[sysschobjs].created, [master].[sys].[sysschobjs].modified, Expr1003, Expr1004, Expr1007, Expr1008",
                                            "isLongString": true
                                        },
                                        {
                                            "name": "Node ID",
                                            "value": "5",
                                            "isLongString": false
                                        }
                                    ],
                                    "badges": [],
                                    "edges": [
                                        {
                                            "id": "element-tvOC2POvtPPc6WXaiuE1JkdqAbD9w5k3",
                                            "metrics": [
                                                {
                                                    "name": "Estimated Number of Rows Per Execution",
                                                    "value": "2575",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated Number of Rows for All Executions",
                                                    "value": "2575",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated Row Size",
                                                    "value": "176 B",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated Data Size",
                                                    "value": "443 KB",
                                                    "isLongString": false
                                                }
                                            ],
                                            "weight": 3.0580829250329074,
                                            "label": ""
                                        }
                                    ],
                                    "children": [
                                        {
                                            "label": "Clustered Index Scan\n[sysschobjs].[clst] [o]",
                                            "tooltipTitle": "Clustered Index Scan\n[sysschobjs].[clst] [o]",
                                            "rowCountDisplayString": "2575",
                                            "costDisplayString": "29%",
                                            "id": "element-8",
                                            "icon": "clusteredIndexScan",
                                            "metrics": [
                                                {
                                                    "name": "Physical Operation",
                                                    "value": "Clustered Index Scan",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Logical Operation",
                                                    "value": "Clustered Index Scan",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated Execution Mode",
                                                    "value": "Row",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Storage",
                                                    "value": "RowStore",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Predicate",
                                                    "value": "[master].[sys].[sysschobjs].[nsclass] as [o].[nsclass]=(0) AND [master].[sys].[sysschobjs].[pclass] as [o].[pclass]=(1)",
                                                    "isLongString": true
                                                },
                                                {
                                                    "name": "Estimated I/O Cost",
                                                    "value": "0.0305324",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated CPU Cost",
                                                    "value": "0.0029895",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated Number of Executions",
                                                    "value": "1",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Object",
                                                    "value": "[master].[sys].[sysschobjs].[clst] [o]",
                                                    "isLongString": true
                                                },
                                                {
                                                    "name": "Estimated Number of Rows Per Execution",
                                                    "value": "2575",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated Number of Rows to be Read",
                                                    "value": "2575",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated Number of Rows for All Executions",
                                                    "value": "2575",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Estimated Row Size",
                                                    "value": "176 B",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Output List",
                                                    "value": "[master].[sys].[sysschobjs].id, [master].[sys].[sysschobjs].name, [master].[sys].[sysschobjs].nsid, [master].[sys].[sysschobjs].status, [master].[sys].[sysschobjs].type, [master].[sys].[sysschobjs].pid, [master].[sys].[sysschobjs].created, [master].[sys].[sysschobjs].modified",
                                                    "isLongString": true
                                                },
                                                {
                                                    "name": "Ordered",
                                                    "value": "False",
                                                    "isLongString": false
                                                },
                                                {
                                                    "name": "Node ID",
                                                    "value": "6",
                                                    "isLongString": false
                                                }
                                            ],
                                            "badges": [],
                                            "edges": [],
                                            "children": [],
                                            "description": "Scanning a clustered index, entirely or only a range.",
                                            "cost": 0.0335219,
                                            "subTreeCost": 0.0335219,
                                            "relativeCost": 0.29017260482670265,
                                            "elapsedTimeInMs": null,
                                            "costMetrics": [
                                                {
                                                    "name": "EstimateRowsAllExecs",
                                                    "value": "2575"
                                                },
                                                {
                                                    "name": "EstimatedRowsRead",
                                                    "value": "2575"
                                                }
                                            ]
                                        }
                                    ],
                                    "description": "Compute new values from existing values in a row.",
                                    "cost": 0.0002575000000000008,
                                    "subTreeCost": 0.0337794,
                                    "relativeCost": 0.0022289740659949516,
                                    "elapsedTimeInMs": null,
                                    "costMetrics": [
                                        {
                                            "name": "EstimateRowsAllExecs",
                                            "value": "2575"
                                        }
                                    ]
                                }
                            ],
                            "description": "Restricting the set of rows based on a predicate.",
                            "cost": 0.004068499999999996,
                            "subTreeCost": 0.0378479,
                            "relativeCost": 0.03521779024272009,
                            "elapsedTimeInMs": null,
                            "costMetrics": [
                                {
                                    "name": "EstimateRowsAllExecs",
                                    "value": "2575"
                                }
                            ]
                        }
                    ],
                    "description": "Use each row from the top input to build a hash table, and each row from the bottom input to probe into the hash table, outputting all matching rows.",
                    "cost": 0.031706000000000005,
                    "subTreeCost": 0.0730713,
                    "relativeCost": 0.2744537931512067,
                    "elapsedTimeInMs": null,
                    "costMetrics": [
                        {
                            "name": "EstimateRowsAllExecs",
                            "value": "2575"
                        }
                    ]
                }
            ],
            "description": "Use each row from the top input to build a hash table, and each row from the bottom input to probe into the hash table, outputting all matching rows.",
            "cost": 0.03913549999999999,
            "subTreeCost": 0.115524,
            "relativeCost": 0.3387651050863889,
            "elapsedTimeInMs": null,
            "costMetrics": [
                {
                    "name": "EstimateRowsAllExecs",
                    "value": "2575"
                }
            ]
        }
    ],
    "description": null,
    "cost": 0,
    "subTreeCost": 0.115524,
    "relativeCost": 0,
    "elapsedTimeInMs": null,
    "costMetrics": [
        {
            "name": "EstimateRowsAllExecs",
            "value": "0"
        }
    ]
}