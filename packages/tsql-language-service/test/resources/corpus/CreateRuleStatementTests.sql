-- sacaglar:  comments inline

-- Two part name
create rule dbo.r1 as @a1 > 10

go

-- One part name
create rule r1 as @a1 > 10 and @a2 between 20 and 39
