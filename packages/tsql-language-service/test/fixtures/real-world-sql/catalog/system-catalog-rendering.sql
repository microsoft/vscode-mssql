-- Small result
select top (10)
    object_id,
    name,
    type,
    create_date,
    modify_date
from sys.objects
order by object_id;

-- Empty result
select *
from sys.objects
where 1 = 0;

-- Nulls, blanks, unicode, long text, JSON/XML-looking values
select
    cast(null as nvarchar(50)) as null_value,
    cast('' as nvarchar(50)) as blank_value,
    N'Unicode: مرحبا 你好 Привет' as unicode_value,
    replicate(cast('long text ' as nvarchar(max)), 50) as long_text,
    N'{"a":1,"b":[true,null,"text"]}' as json_text,
    N'<root><item value="1" /></root>' as xml_text;

-- Multiple result sets
select top (5) name, object_id from sys.objects order by object_id;
select top (5) name, schema_id from sys.tables order by object_id;
select top (5) name, system_type_id from sys.types order by system_type_id;

-- Wide result
select top (50)
    o.object_id,
    o.name,
    o.type,
    o.type_desc,
    o.schema_id,
    o.parent_object_id,
    o.create_date,
    o.modify_date,
    s.name as schema_name,
    concat(s.name, '.', o.name) as full_name
from sys.objects o
join sys.schemas s on s.schema_id = o.schema_id
order by o.object_id;

-- Large result
with n as (
    select top (10000)
        row_number() over (order by (select null)) as id
    from sys.all_objects a
    cross join sys.all_objects b
)
select
    id,
    concat('row-', id) as label,
    id % 17 as bucket,
    case when id % 11 = 0 then null else concat('value-', id % 100) end as nullable_text
from n
order by id;

-- Messages and errors
print 'before result';
select top (3) name from sys.objects;
print 'after result';
raiserror('manual test warning', 10, 1);
