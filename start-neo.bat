@echo off
cd /d "%~dp0"
if not exist node_modules npm install
if "%NODE_ENV%"=="" set NODE_ENV=development
if "%NEO_DEMO_MODE%"=="" set NEO_DEMO_MODE=true
if "%PORT%"=="" set PORT=3000
node server.js
pause
