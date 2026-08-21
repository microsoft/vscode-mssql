-- sacaglar:  comments inline

-- Two part name
CREATE XML SCHEMA COLLECTION dbo.MyCollection AS @MySchemaCollection 

go

-- One part name
CREATE XML SCHEMA COLLECTION MyCollection AS 'Some xml text'

