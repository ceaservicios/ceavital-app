@echo off
title CEAVital - Lanzador

echo Iniciando CEAVital (backend + frontend)...

start "CEAVital - Backend (8443)" cmd /k "cd /d "F:\Agencia CEA Servicios\Proyecto CEAVital\Sistema\app" && npm run dev"

timeout /t 3 /nobreak >nul

start "CEAVital - Frontend (5173)" cmd /k "cd /d "F:\Agencia CEA Servicios\Proyecto CEAVital\Sistema\app\frontend" && npm run dev"

timeout /t 3 /nobreak >nul

start "" "http://localhost:5173"
