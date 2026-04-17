$ErrorActionPreference = "Stop"

$temp = Join-Path $env:TEMP ("verceldeploy-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temp | Out-Null

try {
  $tarball = Join-Path $temp "project.tgz"

  tar -czf $tarball `
    --exclude=node_modules `
    --exclude=.git `
    --exclude=.next `
    --exclude=.env `
    --exclude=.env.* `
    -C $PSScriptRoot .

  $response = & curl.exe -s -X POST "https://codex-deploy-skills.vercel.sh/api/deploy" `
    -F "file=@$tarball" `
    -F "framework=nextjs"

  if ($LASTEXITCODE -ne 0) {
    throw "Deployment upload failed."
  }

  $responseObj = $response | ConvertFrom-Json

  if ($responseObj.error) {
    throw $responseObj.error
  }

  $previewUrl = $responseObj.previewUrl
  $claimUrl = $responseObj.claimUrl

  Write-Output "PREVIEW=$previewUrl"
  Write-Output "CLAIM=$claimUrl"

  for ($i = 0; $i -lt 60; $i++) {
    try {
      $status = & curl.exe -s -o NUL -w "%{http_code}" $previewUrl
      if ([int]$status -lt 500) {
        break
      }
    } catch {
    }

    Start-Sleep -Seconds 5
  }
} finally {
  if (Test-Path $temp) {
    Remove-Item -Recurse -Force $temp
  }
}
