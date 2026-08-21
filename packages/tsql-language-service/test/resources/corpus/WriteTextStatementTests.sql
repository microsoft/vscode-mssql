-- sacaglar, comments inline

-- all variations
writetext t1.c1 0xABAA10 @str
writetext bulk t1.c1 @var  'hi'
writetext t1.c1 @var with log null
writetext t1.c1 100 'hello'
writetext t1.c1 10 with log N'hello'
writetext t1.c1 @var 0xFF
