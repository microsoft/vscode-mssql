-- sacaglar, comments inline

-- all variations
updatetext t1.c1 0xABAA10 @InsertOffset null @str
updatetext bulk t1.c1 @var TimeStamp = 0xFFFF null @DeleteLength 'hi'
updatetext bulk t1.c1 1234 @var1 -15 dbo.[t1].[c1] @col
updatetext t1.c1 @var @var1 -15 with log null
updatetext t1.c1 100 @var1 -15 'hello'
updatetext t1.c1 10 @var1 -15 with log N'hello'
updatetext t1.c1 @var @var1 -15 0xFF
updatetext t1.c1 @var @var1 -15 t1.c2 @var2
updatetext t1.c1 @var @var1 -15 .t1.c2 0xABC

-- Also without data - Dev10 670457
UPDATETEXT dbo.t1 @ptrval @Position @PropLen   
