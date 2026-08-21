-- sacaglar:  comments inline
-- Break and continue statements are tested here.

-- one statement
Begin

create table t1(c1 int)

End


-- multiple statements

Begin

create table t1(c1 int)
set ANSI_NULLS ON;
create table t2(c1 int);

End

-- nested begin ends
Begin
Begin
Begin
create table t1(c1 int);
set ANSI_NULLS ON;
End
End
End

-- break on its own
break

-- continue on its own
continue

-- break and continue in the context of begin end
Begin
create table t1(c1 int)
break
set ANSI_NULLS ON;
create table t2(c1 int);
continue
End
