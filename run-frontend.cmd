@echo off
pushd "%~dp0"
dotnet run --urls http://localhost:5500
set "runExitCode=%errorlevel%"
popd
exit /b %runExitCode%
exit /b %errorlevel%
