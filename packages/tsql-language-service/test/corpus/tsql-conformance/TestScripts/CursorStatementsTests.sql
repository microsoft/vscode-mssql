OPEN authorcursor
CLOSE global c1
DEALLOCATE @cursorVar

FETCH NEXT FROM authors_cursor INTO @au_lname, @au_fname
FETCH ABSOLUTE 2 FROM global ac
FETCH ABSOLUTE @someVar FROM ac
FETCH RELATIVE -2 FROM @cursorVar2
FETCH authors_cursor
FETCH PRIOR FROM ac
FETCH FIRST FROM ac
FETCH LAST FROM ac
