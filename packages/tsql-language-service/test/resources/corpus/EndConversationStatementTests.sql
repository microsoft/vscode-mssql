-- test for resolving ambiguity
create proc p1 as
begin
	-- Try body
	begin try 
		end conversation 10
		enable trigger t1 on o1
	end try
	-- Catch body
	begin catch
		end conversation 10
		enable trigger t1 on o1
	end catch
	-- Simple begin/end
	begin
		end conversation 10
		enable trigger t1 on o1
	end
	end conversation 10
	enable trigger t1 on o1
	
	begin try 
		declare @v1 int
	end try
	begin catch
	end catch
end

-- End conversation options...
end conversation 1 with error = @v1 description = 'd1'
end conversation 1 with error = 10 description = 'd2'
end conversation 1 with cleanup
