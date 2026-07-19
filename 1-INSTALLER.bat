@echo off
chcp 65001 >nul
title Change RDC - Installation des prerequis

REM --- Se relancer en administrateur si besoin (winget en a besoin) ---
net session >nul 2>nul
if errorlevel 1 (
  echo Demande des droits administrateur... clique OUI dans la fenetre Windows.
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ==================================================
echo    INSTALLATION DES PREREQUIS ^(une seule fois^)
echo    - Node.js  ^(le moteur de l'application^)
echo    - Docker   ^(la base de donnees^)
echo ==================================================
echo.

echo [1/2] Installation de Node.js...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements

echo.
echo [2/2] Installation de Docker Desktop...
winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements

echo.
echo ==================================================
echo    TERMINE !
echo.
echo    ETAPE SUIVANTE, IMPORTANTE :
echo    1^) Redemarre ton ordinateur maintenant.
echo    2^) Ensuite, double-clique sur "2-DEMARRER.bat".
echo ==================================================
echo.
pause
