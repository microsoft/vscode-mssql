--create cci with ordered columns
CREATE CLUSTERED COLUMNSTORE INDEX CI_Order
ON dbo.[Table_HEAP_CCI] ORDER(column_1, column_3);