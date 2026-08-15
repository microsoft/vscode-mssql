-- multiple row nulls
select NULL as null_value, NULL as another_null_value
union all
select NULL as null_value, NULL as another_null_value
union all
select NULL as null_value, NULL as another_null_value
