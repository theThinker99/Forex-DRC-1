@echo off
chcp 65001 >nul
title Change RDC - Application
cd /d "D:\@Michael_Projects-2021\change-rdc"

echo ==================================================
echo    CHANGE RDC - Demarrage de l'application
echo ==================================================
echo.

REM --- Verifier que Node.js est installe ---
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js n'est pas detecte. Lance "1-INSTALLER.bat" puis redemarre le PC.
  pause
  exit /b 1
)

REM --- Copier la config vers l'API (pour l'outil de base de donnees) ---
copy /Y ".env" "apps\api\.env" >nul

REM --- Verifier que PostgreSQL repond sur le port 5432 ---
echo [1/4] Verification de la base de donnees...
powershell -NoProfile -Command "if (-not (Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 1 }"
if errorlevel 1 (
  echo     La base ne repond pas encore. Tentative de demarrage du service...
  net start postgresql-x64-16 >nul 2>nul
  timeout /t 5 >nul
  powershell -NoProfile -Command "if (-not (Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 1 }"
  if errorlevel 1 (
    echo.
    echo [X] La base de donnees PostgreSQL n'est pas demarree.
    echo     As-tu bien lance "INSTALLER-BASE.bat" une premiere fois ?
    echo     Si oui, redemarre le PC et relance ce fichier.
    pause
    exit /b 1
  )
)
echo     Base de donnees prete.

REM --- Installer les composants (uniquement la premiere fois) ---
if not exist "node_modules" (
  echo [2/4] Premiere installation des composants...
  echo       ^(2 a 5 minutes, UNE SEULE FOIS - ne ferme pas la fenetre^)
  call npm install
) else (
  echo [2/4] Composants deja installes.
)

REM --- Creer / mettre a jour les tables + donnees de demo (idempotent) ---
echo [3/4] Preparation des tables et des donnees de demo...
call npm run db:push
call npm run db:seed

REM --- Ouvrir le navigateur automatiquement apres le demarrage ---
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 25; Start-Process 'http://localhost:3000'"

echo [4/4] Lancement de l'application...
echo.
echo ==================================================
echo    C'EST PARTI !
echo    Ton navigateur s'ouvrira tout seul dans ~25 sec
echo    sur  http://localhost:3000
echo.
echo    Connexion :
echo       Email        admin@change-rdc.cd
echo       Mot de passe ChangeRDC2026!
echo.
echo    NE FERME PAS cette fenetre tant que tu utilises l'app.
echo    Pour arreter : appuie sur Ctrl + C.
echo ==================================================
echo.
call npm run dev
pause
