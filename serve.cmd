@echo off
REM 遮罩工具 censor.html 需要以 http:// 開啟才能載入偵測模型。
REM （file:// 下每個本機檔案是獨立來源，fetch 模型會被瀏覽器擋掉）
REM 套框工具 index.html 不需要這個，直接雙擊即可。
echo.
echo   起本機 server... 開啟 http://localhost:3000/censor.html
echo   結束請按 Ctrl+C
echo.
npx --yes serve . -l 3000
