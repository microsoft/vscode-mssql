-- sacaglar, comments inline

-- Create route statement
--basic
create route r1 with broker_instance = 'b1'

-- testing authorization
create route [r1] authorization [dbo] with broker_instance = 'b1'

-- testing Options
create route r1 with service_name = 's1'
create route r1 authorization [dbo] with broker_instance = 'b1', lifetime = 23, address = 'a1', mirror_address = 'ma1', service_name = 's1'

Go

-- Alter route statement
alter route r1 with broker_instance = 'b1', lifetime = 23, address = 'a1', mirror_address = 'ma1', service_name = 's1'
