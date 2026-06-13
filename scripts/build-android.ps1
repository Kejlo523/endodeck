$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'
$build = Join-Path $android 'build'
$dist = Join-Path $root 'dist'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$platform = Join-Path $sdk 'platforms\android-36\android.jar'
$tools = Join-Path $sdk 'build-tools\36.1.0'
$aapt = Join-Path $tools 'aapt.exe'
$d8 = Join-Path $tools 'd8.bat'
$zipalign = Join-Path $tools 'zipalign.exe'
$apksigner = Join-Path $tools 'apksigner.bat'
$keytool = 'C:\Program Files\Java\jdk-25.0.2\bin\keytool.exe'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$keystore = Join-Path $android 'endodeck-debug.keystore'

if (Test-Path $build) { Remove-Item -LiteralPath $build -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $build 'classes'), (Join-Path $build 'dex'), $dist -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $build 'native\lib\armeabi-v7a') -Force | Out-Null

& $aapt package -f -M (Join-Path $android 'AndroidManifest.xml') -A (Join-Path $android 'assets') -I $platform -F (Join-Path $build 'base-unsigned.apk')
if ($LASTEXITCODE -ne 0) { throw 'aapt failed to build the resource package.' }

$source = Join-Path $android 'src\pl\endozero\endodeck\MainActivity.java'
& javac -source 8 -target 8 -encoding UTF-8 -classpath $platform -d (Join-Path $build 'classes') $source
if ($LASTEXITCODE -ne 0) { throw 'javac failed to compile the application.' }

$classFiles = Get-ChildItem -Path (Join-Path $build 'classes') -Recurse -Filter '*.class' | ForEach-Object FullName
& $d8 --min-api 21 --lib $platform --output (Join-Path $build 'dex') $classFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed to create the DEX file.' }

Push-Location (Join-Path $build 'dex')
try {
    & $aapt add (Join-Path $build 'base-unsigned.apk') 'classes.dex'
    if ($LASTEXITCODE -ne 0) { throw 'Failed to add classes.dex.' }
} finally {
    Pop-Location
}

# The ROM's WebView 119 contains only armeabi-v7a. A small unused 32-bit ELF
# makes Package Manager launch this Java-only app in the matching 32-bit zygote.
$abiMarker = Join-Path $build 'native\lib\armeabi-v7a\libendodeck.so'
& $adb pull '/system/lib/liblog.so' $abiMarker | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to obtain the 32-bit ABI marker from the device.' }
Push-Location (Join-Path $build 'native')
try {
    & $aapt add (Join-Path $build 'base-unsigned.apk') 'lib/armeabi-v7a/libendodeck.so'
    if ($LASTEXITCODE -ne 0) { throw 'Failed to add the 32-bit ABI marker.' }
} finally {
    Pop-Location
}

if (-not (Test-Path $keystore)) {
    & $keytool -genkeypair -keystore $keystore -storepass endodeck -keypass endodeck -alias endodeck -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=EndoDeck, O=EndoZero, C=PL'
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the signing key.' }
}

$aligned = Join-Path $build 'endodeck-aligned.apk'
$output = Join-Path $dist 'EndoDeck.apk'
& $zipalign -f 4 (Join-Path $build 'base-unsigned.apk') $aligned
& $apksigner sign --ks $keystore --ks-pass pass:endodeck --key-pass pass:endodeck --out $output $aligned
& $apksigner verify --verbose $output
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }

Write-Output $output
