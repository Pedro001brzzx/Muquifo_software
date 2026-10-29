@echo off
rem Liga o Muquifo nesta maquina: atualiza o build, aplica migracoes do banco e
rem serve o sistema e o cardapio do cliente na porta 3000 para a rede local.
rem Provisorio ate o instalador (servico do Windows).
title Muquifo - servidor
cd /d "%~dp0"
call pnpm run servidor
pause
