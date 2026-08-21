-- sacaglar:  comments inline

-- basic version
CREATE ASSEMBLY HelloWorld authorization dbo
FROM @FullPath

CREATE ASSEMBLY HelloWorld 
FROM @SamplesPath + 'HelloWorld\CS\HelloWorld\bin\debug\HelloWorld.dll'
WITH PERMISSION_SET = SAFE

CREATE ASSEMBLY HelloWorld authorization dbo
FROM @FullPath, @SamplesPath + 'HelloWorld\CS\HelloWorld\bin\debug\HelloWorld.dll'
WITH PERMISSION_SET = UNSAFE

CREATE ASSEMBLY HelloWorld 
FROM @FullPath, @SamplesPath + 'HelloWorld\CS\HelloWorld\bin\debug\HelloWorld.dll', 'a.dll'
WITH PERMISSION_SET = EXTERNAL_ACCESS