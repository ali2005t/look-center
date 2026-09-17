# تشغيل تطبيق Electron
$env:PATH = "$PSScriptRoot\node;$env:PATH"
cd "$PSScriptRoot"

Write-Host "جاري تشغيل تطبيق LOOK CASHIER..." -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green

& ".\node\node.exe" ".\node_modules\electron\dist\electron.exe" "." $args

Write-Host "البرنامج أُغلق" -ForegroundColor Yellow
