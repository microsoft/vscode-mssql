-- test statements inside waitfor
WAITFOR (RECEIVE * FROM ExpenseQueue), TIMEOUT 60000
GO
WAITFOR (GET CONVERSATION GROUP @conversation_group_id FROM ExpenseQueue)