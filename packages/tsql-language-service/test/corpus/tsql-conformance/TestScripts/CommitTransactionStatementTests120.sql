-- basic cases
commit with (delayed_durability = on);
commit with (delayed_durability = off);
commit tran with (delayed_durability = on);
commit tran with (delayed_durability = off);
commit transaction with (delayed_durability = on);
commit transaction with (delayed_durability = off);

-- Identifier
commit tran myTransaction with (delayed_durability = on);
commit tran myTransaction with (delayed_durability = off);

-- variable
commit transaction @tranVariable with (delayed_durability = on);
commit transaction @tranVariable with (delayed_durability = off);