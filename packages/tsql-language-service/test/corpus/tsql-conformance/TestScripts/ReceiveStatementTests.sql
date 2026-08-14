RECEIVE * FROM db1.dbo.ExpenseQueue
RECEIVE TOP(1) conversation_handle, message_type_name, message_body FROM ExpenseQueue 
RECEIVE @v1 = 10, 20, 
	CASE 
		WHEN validation = 'X' THEN CAST(message_body as XML)
        ELSE NULL
	END AS message_body 
FROM ExpenseQueue

RECEIVE * FROM ExpenseQueue INTO @procTable WHERE conversation_group_id = @conversation_group_id 
RECEIVE * FROM ExpenseQueue WHERE conversation_handle = @handle 
