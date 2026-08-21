-- sacaglar, comments inline

-- Create application role statement
CREATE APPLICATION ROLE weekly_receipts 
    WITH PASSWORD = '987'
    
CREATE APPLICATION ROLE [weekly_receipts]
    WITH PASSWORD = 'PLACEHOLDER1', DEFAULT_SCHEMA = Sales;

GO
 -- Alter application role statement
ALTER APPLICATION ROLE receipts_ledger 
    WITH NAME = weekly_ledger, 
    PASSWORD = '897', 
    DEFAULT_SCHEMA = Production,
    LOGIN = l1;
