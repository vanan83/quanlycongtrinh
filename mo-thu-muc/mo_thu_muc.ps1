# Quan ly cong trinh - "Mo 1 cham": mo thu muc cong trinh tren may tu lien ket qlct-open:
# Trinh duyet goi:  powershell -File mo_thu_muc.ps1 "qlct-open:G%3A%5CMy%20Drive%5C..."
# An toan: lien ket chi la DU LIEU (khong chay lenh), va chi mo khi do la THU MUC co that.
param([string]$Link)
$p = $Link -replace '^qlct-open:(//)?', ''
try { $p = [uri]::UnescapeDataString($p) } catch { exit 1 }
$p = $p.Trim().TrimEnd('/')
if ($p -and (Test-Path -LiteralPath $p -PathType Container -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList ('"' + $p + '"')
} else {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Khong tim thay thu muc tren may nay:`n`n$p`n`nKiem tra lai duong dan thu muc goc trong app (Tai khoan / Thiet lap) hoac cho Google Drive dong bo xong.", "Quan ly cong trinh") | Out-Null
}
