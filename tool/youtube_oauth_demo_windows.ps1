$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "SIGILLUM YouTube OAuth verification demo" -ForegroundColor Cyan
Write-Host "This launcher does not print the OAuth client secret or refresh token." -ForegroundColor DarkGray
Write-Host ""

$clientId = Read-Host "OAuth Client ID"
if ([string]::IsNullOrWhiteSpace($clientId)) { throw "OAuth Client ID is required." }

$channelId = Read-Host "SIGILLUM YouTube Channel ID"
if ([string]::IsNullOrWhiteSpace($channelId)) { throw "YouTube Channel ID is required." }

$secureSecret = Read-Host "OAuth Client Secret (hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)

try {
    $plainSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrWhiteSpace($plainSecret)) { throw "OAuth Client Secret is required." }

    $env:YOUTUBE_CLIENT_ID = $clientId.Trim()
    $env:YOUTUBE_CLIENT_SECRET = $plainSecret
    $env:YOUTUBE_CHANNEL_ID = $channelId.Trim()
    $env:YOUTUBE_OAUTH_LOCAL_PORT = "53682"
    $env:YOUTUBE_REFRESH_TOKEN_OUTPUT = ".sigillum-youtube-refresh-token.txt"
    $env:YOUTUBE_REFRESH_TOKEN_FILE = ".sigillum-youtube-refresh-token.txt"

    Write-Host ""
    Write-Host "Required Google Cloud authorized redirect URI:" -ForegroundColor Yellow
    Write-Host "http://127.0.0.1:53682/oauth2/callback"
    Write-Host ""
    Write-Host "Step 1/2 - OAuth grant and production refresh token" -ForegroundColor Cyan
    npm run youtube:oauth:provision
    if ($LASTEXITCODE -ne 0) { throw "OAuth provisioning failed." }

    Write-Host ""
    Write-Host "Step 2/2 - youtube.force-ssl upload/status/comments/delete demo" -ForegroundColor Cyan
    npm run youtube:scope:demo
    if ($LASTEXITCODE -ne 0) { throw "YouTube scope demonstration failed." }

    Write-Host ""
    Write-Host "DEMO COMPLETE" -ForegroundColor Green
    Write-Host "The refresh token remains only in .sigillum-youtube-refresh-token.txt."
    Write-Host "Paste it directly into Render as YOUTUBE_REFRESH_TOKEN, then securely delete the local file."
}
finally {
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    $env:YOUTUBE_CLIENT_SECRET = $null
    $env:YOUTUBE_CLIENT_ID = $null
    $env:YOUTUBE_CHANNEL_ID = $null
    $env:YOUTUBE_OAUTH_LOCAL_PORT = $null
    $env:YOUTUBE_REFRESH_TOKEN_OUTPUT = $null
    $env:YOUTUBE_REFRESH_TOKEN_FILE = $null
    Remove-Variable plainSecret -ErrorAction SilentlyContinue
}
