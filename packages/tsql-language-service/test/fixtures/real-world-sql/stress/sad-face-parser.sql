if @error_count = 0
begin
    COMMIT TRANSACTION @tran_name;
    insert into ##LOGS values('Processo finalizado com sucesso!');
end
else
begin
    insert into ##LOGS values('Encontrado erros durante a atualização :(');
end;
