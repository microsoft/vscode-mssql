-- sacaglar:  comments inline

-- Two part name
Alter XML SCHEMA COLLECTION dbo.MyCollection ADD @MySchemaCollection 

go

-- One part name
Alter XML SCHEMA COLLECTION MyCollection ADD 'Some xml text'

