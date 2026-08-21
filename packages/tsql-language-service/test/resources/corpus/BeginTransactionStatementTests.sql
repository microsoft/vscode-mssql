--sacaglar, comments inline

-- basic case
begin tran

-- basic case
begin transaction

-- Identifier
begin tran myTransaction

-- basic case, distributed
begin distributed transaction

-- Identifier, distributed
begin distributed tran myTransaction

-- variable
begin transaction @tranVariable

-- with mark
begin tran with mark
begin tran myTransaction with mark

-- unicode
begin transaction @tranVariable with mark N'some tran'

-- ascii
begin tran myTransaction with mark 'ascii literal'

--variable, books online misses this.
begin tran myTransaction with mark @descVariable



