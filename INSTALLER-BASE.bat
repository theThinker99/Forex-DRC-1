@echo off
chcp 65001 >nul
title Change RDC - Installation de la base de donnees

REM --- Auto-elevation en administrateur (winget en a besoin) ---
net session >nul 2>nul
if errorlevel 1 (
  echo Autorisation administrateur requise...
  echo Clique OUI dans la fenetre bleue de Windows qui va apparaitre.
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ==================================================
echo    INSTALLATION DE LA BASE DE DONNEES (PostgreSQL)
echo    Sans Docker. A faire une seule fois.
echo ==================================================
echo.

echo [1/3] Telechargement et installation de PostgreSQL...
echo       ^(3 a 6 minutes selon ta connexion, patiente^)
winget install -e --id PostgreSQL.PostgreSQL.16 --accept-package-agreements --accept-source-agreements --override "--mode unattended --unattendedmodeui none --superpassword change_rdc_dev --serverport 5432"

REM --- Localiser le dossier d'outils de PostgreSQL ---
set "PGBIN="
for /d %%d in ("C:\Program Files\PostgreSQL\*") do set "PGBIN=%%d\bin"
if not defined PGBIN (
  echo.
  echo [X] PostgreSQL ne semble pas s'etre installe correctement.
  echo     Reessaie, ou previens Claude avec ce message.
  pause
  exit /b 1
)
echo     Installe dans : %PGBIN%

echo [2/3] Demarrage du service de base de donnees...
timeout /t 8 >nul

echo [3/3] Creation de la base "change_rdc" et de son utilisateur...
set "PGPASSWORD=change_rdc_dev"
"%PGBIN%\psql.exe" -U postgres -h localhost -p 5432 -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='change_rdc') THEN CREATE ROLE change_rdc WITH LOGIN PASSWORD 'change_rdc_dev' CREATEDB; END IF; END $$;"
"%PGBIN%\psql.exe" -U postgres -h localhost -p 5432 -tc "SELECT 1 FROM pg_database WHERE datname='change_rdc'" | findstr "1" >nul || "%PGBIN%\psql.exe" -U postgres -h localhost -p 5432 -c "CREATE DATABASE change_rdc OWNER change_rdc;"

echo.
echo ==================================================
echo    TERMINE ! La base de donnees est prete.
echo.
echo    ETAPE SUIVANTE :
echo    Double-clique maintenant sur "2-DEMARRER.bat".
echo ==================================================
echo.
pause
