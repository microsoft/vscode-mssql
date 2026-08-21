-- Basic JSON index creation
CREATE JSON INDEX IX_JSON_Basic ON dbo.Users (JsonData);

-- JSON index with FOR clause (single path)
CREATE JSON INDEX IX_JSON_SinglePath ON dbo.Users (JsonData)
FOR ('$.name');

-- JSON index with FOR clause (multiple paths)
CREATE JSON INDEX IX_JSON_MultiplePaths ON dbo.Users (JsonData)
FOR ('$.name', '$.email', '$.age');

-- JSON index with WITH options
CREATE JSON INDEX IX_JSON_WithOptions ON dbo.Users (JsonData)
WITH (FILLFACTOR = 90, ONLINE = OFF);

-- JSON index with FOR clause and WITH options
CREATE JSON INDEX IX_JSON_Complete ON dbo.Users (JsonData)
FOR ('$.profile.name', '$.profile.email')
WITH (MAXDOP = 4, DATA_COMPRESSION = ROW);

-- JSON index on schema-qualified table
CREATE JSON INDEX IX_JSON_Schema ON MySchema.MyTable (JsonColumn)
FOR ('$.properties.value');

-- JSON index with quoted identifiers
CREATE JSON INDEX [IX JSON Index] ON [dbo].[Users] ([Json Data])
FOR ('$.data.attributes');

-- JSON index with complex path expressions
CREATE JSON INDEX IX_JSON_Complex ON dbo.Documents (Content)
FOR ('$.metadata.title', '$.content.sections[*].text', '$.tags[*]');

-- Create JSON index with OPTIMIZE_FOR_ARRAY_SEARCH option
CREATE JSON INDEX IX_JSON ON dbo.Users (JsonData) 
WITH (OPTIMIZE_FOR_ARRAY_SEARCH = ON);

-- Create JSON index with PAD_INDEX and DROP_EXISTING options
CREATE JSON INDEX IX_JSON ON dbo.Users (JsonData) 
WITH (PAD_INDEX = ON, DROP_EXISTING = ON);