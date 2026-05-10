@echo off
cd /d c:\Users\sowon\taeraeee
echo Checking index.js...
node --check index.js
echo.
echo Checking commands\pay.js...
node --check commands\pay.js
echo.
echo Checking commands\cards\drop.js...
node --check commands\cards\drop.js
echo.
echo Checking commands\cards\claim.js...
node --check commands\cards\claim.js
echo.
echo Checking commands\gift.js...
node --check commands\gift.js
echo.
echo Checking commands\leaderboard.js...
node --check commands\leaderboard.js
echo.
echo Checking commands\profile.js...
node --check commands\profile.js
echo.
echo Syntax check complete.
