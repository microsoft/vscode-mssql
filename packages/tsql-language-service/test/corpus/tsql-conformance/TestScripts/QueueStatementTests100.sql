-- There is new option POISON_MESSAGE_HANDLING in Sql Server 10.5 (KJ)

create queue q1 with status = on, poison_message_handling(status = on), retention = off

Go

alter queue dbo.q1 with poison_message_handling(status = off), activation(drop)