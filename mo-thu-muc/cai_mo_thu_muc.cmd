@echo off
rem Quan ly cong trinh - cai "Mo 1 cham" cho may nay (khong can quyen quan tri).
rem Dang ky lien ket qlct-open: de bam nut May tinh trong app la mo thu muc cong trinh.
rem Go cai dat:  reg delete "HKCU\Software\Classes\qlct-open" /f
setlocal
set "DIR=%LOCALAPPDATA%\QuanLyCongTrinh"
if not exist "%DIR%" mkdir "%DIR%"
echo Dang tai mo_thu_muc.ps1 ...
curl -fsSL "https://vanan83.github.io/quanlycongtrinh/mo-thu-muc/mo_thu_muc.ps1" -o "%DIR%\mo_thu_muc.ps1"
if errorlevel 1 (
  echo.
  echo Khong tai duoc. Kiem tra mang roi chay lai.
  pause
  exit /b 1
)
reg add "HKCU\Software\Classes\qlct-open" /ve /d "URL:Quan ly cong trinh - mo thu muc" /f >nul
reg add "HKCU\Software\Classes\qlct-open" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\qlct-open\shell\open\command" /ve /d "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DIR%\mo_thu_muc.ps1\" \"%%1\"" /f >nul
echo.
echo DA CAI XONG "Mo 1 cham".
echo Vao app: Tai khoan / Thiet lap ^> Thu muc tren may tinh nay ^> chon "Mo thang thu muc" ^> Luu.
echo.
pause
