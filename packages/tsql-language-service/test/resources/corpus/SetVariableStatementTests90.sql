-- testing the UDT related syntax

-- dot property
set @a.b = 12 / 34
go
-- doublecolon property
set @a::b = 12 / 34
go
-- dot functioncall empty
set @a.b()
go
-- dot functioncall 
set @a.b(1, default, a.b::func())
go
-- doublecolon functioncall empty
set @a::b()
go
-- doublecolon functioncall 
set @a::b(1, default, a.b::func())

