@echo off
REM ============================================================
REM install_samurai.bat
REM Installe SAMURAI (yangchris11/samurai) dans l'environnement conda IA_env.
REM SAMURAI etend SAM2 avec un filtre de Kalman pour un tracking video robuste.
REM Repo : https://github.com/yangchris11/samurai
REM
REM Methode : clone du repo dans backend/ext/samurai_repo/
REM           puis pip install -e du sous-dossier sam2/
REM           (meme checkpoints SAM2, configs differentes avec samurai_mode=true)
REM ============================================================

echo [SAMURAI] Installation de SAMURAI dans IA_env...
echo [SAMURAI] Cela peut prendre quelques minutes.

set SCRIPT_DIR=%~dp0
set SAMURAI_DIR=%SCRIPT_DIR%backend\ext\samurai_repo

REM --- Etape 1 : cloner ou mettre a jour le repo SAMURAI ---
if exist "%SAMURAI_DIR%" (
    echo [SAMURAI] Repo deja present, mise a jour...
    cd "%SAMURAI_DIR%"
    git pull
) else (
    echo [SAMURAI] Clone du repo SAMURAI...
    mkdir "%SCRIPT_DIR%backend\ext" 2>nul
    git clone https://github.com/yangchris11/samurai.git "%SAMURAI_DIR%"
    if %ERRORLEVEL% NEQ 0 (
        echo [SAMURAI] ERREUR : clone git echoue. Verifier la connexion internet.
        pause
        exit /b 1
    )
)

REM --- Etape 2 : installer le sous-package sam2/ (fork SAMURAI de SAM2) ---
echo [SAMURAI] Installation du package sam2 (fork SAMURAI)...
REM Utilise le python de l'environnement conda actif (aucun chemin en dur).
REM Activer l'env avant : conda activate IA_env
python -m pip install -e "%SAMURAI_DIR%\sam2" --no-deps

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SAMURAI] Installation reussie !
    echo [SAMURAI] Le fork SAMURAI de SAM2 remplace la version originale.
    echo [SAMURAI] Les configs SAMURAI sont dans : backend/ext/samurai_repo/sam2/sam2/configs/samurai/
    echo [SAMURAI] Memes checkpoints que SAM2 standard -- aucun telechargement supplementaire.
    echo.
    echo [SAMURAI] Redemarrer le backend pour activer SAMURAI (samurai_mode=true + filtre Kalman).
) else (
    echo [SAMURAI] ERREUR : pip install echoue. Verifier les logs ci-dessus.
)

pause
