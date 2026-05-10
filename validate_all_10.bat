@echo off
setlocal enabledelayedexpansion
cd /d C:\Users\sowon\taerae2

echo.
echo Validation Results:
echo ==================
echo.

set passed=0
set failed=0

echo 1. Checking services/CardGenerationService.js...
node --check "services/CardGenerationService.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 2. Checking commands/show cards/info.js...
node --check "commands/show cards/info.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 3. Checking commands/deck.js...
node --check "commands/deck.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 4. Checking commands/admin only/autoaddcard.js...
node --check "commands/admin only/autoaddcard.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 5. Checking commands/admin only/scancards.js...
node --check "commands/admin only/scancards.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 6. Checking commands/admin only/addcard.js...
node --check "commands/admin only/addcard.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 7. Checking commands/admin only/fix.js...
node --check "commands/admin only/fix.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 8. Checking commands/admin only/adminfix.js...
node --check "commands/admin only/adminfix.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 9. Checking index.js...
node --check "index.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo 10. Checking scripts/migrateCardImagePaths.js...
node --check "scripts/migrateCardImagePaths.js" 2>&1
if !errorlevel! equ 0 (
  echo    PASS
  set /a passed+=1
) else (
  echo    FAIL
  set /a failed+=1
)

echo.
echo ==================
echo Passed: !passed!/10
echo Failed: !failed!/10
echo ==================
