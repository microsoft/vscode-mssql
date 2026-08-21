-- Azure options
create database d1 (service_objective = 'basic')
create database d1 (maxsize = 100 mb)
create database d1 (edition = 'business', service_objective = 'shared')
create database d1 (maxsize = 1 gb, service_objective = 'shared')
create database d1 (maxsize = 100 mb, edition = 'web', service_objective = 'shared')
go

alter database d1 modify (service_objective = 'basic')
alter database d1 modify (maxsize = 100 mb)
alter database d1 modify (edition = 'basic', service_objective = 'basic')
alter database d1 modify (service_objective = 'basic', maxsize = 100 mb)
alter database d1 modify (maxsize = 1 gb, edition = 'basic', service_objective = 'basic')
go

-- Azure elastic pool
create database d1 (service_objective = elastic_pool(name = [epool1] ))
alter database d1 modify (service_objective = elastic_pool(name = [epool2] ))
go

-- DB copy with service_objective
create database d1_copy as copy of d1
create database d2_copy as copy of d2 (service_objective = 'HS_Gen5_2')
create database d3_copy as copy of d3 (service_objective = elastic_pool(name = [epool2] ))
create database d4_copy as copy of server1.d4 (service_objective = elastic_pool(name = [epool3] ))
