-- tests for different styles of ip address

create endpoint e1 state = stopped as tcp(listener_ip = (1.2.3.4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2.3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2. 3.4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2. 3. 4)) for tsql()
GO

create endpoint e1 state = stopped as tcp(listener_ip = (1.2 .3 . 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2.3 . 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2. 3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2. 3 . 4)) for tsql()
GO

create endpoint e1 state = stopped as tcp(listener_ip = (1.2 . 3.4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1.2 . 3. 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1.2 . 3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1.2 . 3 . 4)) for tsql()
GO

create endpoint e1 state = stopped as tcp(listener_ip = (1. 2 .3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2 .3 . 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2 . 3.4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2 . 3. 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2 . 3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1. 2 . 3 . 4)) for tsql()
GO

create endpoint e1 state = stopped as tcp(listener_ip = (1 .2 .3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 .2 .3 . 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 .2 . 3.4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 .2 . 3. 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 .2 . 3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 .2 . 3 . 4)) for tsql()
GO

create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2.3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2. 3.4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2. 3. 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2.3 . 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2. 3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2. 3 . 4)) for tsql()
GO

create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2 .3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2 .3 . 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2 . 3.4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2 . 3. 4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2 . 3 .4)) for tsql()
create endpoint e1 state = stopped as tcp(listener_ip = (1 . 2 . 3 . 4)) for tsql()
