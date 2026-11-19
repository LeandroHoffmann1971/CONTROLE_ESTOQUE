$ErrorActionPreference = "Stop"

$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env"
if (-not (Test-Path -LiteralPath $envFile)) {
    throw "Arquivo .env não encontrado na raiz do projeto."
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    $trimmedLine = $line.Trim()
    if (-not $trimmedLine -or $trimmedLine.StartsWith("#")) {
        continue
    }

    if ($trimmedLine -notmatch '^(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)$') {
        throw "Linha inválida no arquivo .env."
    }

    $name = $matches.name
    $value = $matches.value.Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $settings[$name] = $value
}

$secretKey = $settings["SUPABASE_SECRET_KEY"]
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    $secretKey = $settings["SUPABASE_SERVICE_ROLE_KEY"]
}
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    throw "Preencha SUPABASE_SECRET_KEY no arquivo .env antes de iniciar."
}

$previousUrl = $env:SUPABASE__URL
$previousSecret = $env:SUPABASE_SECRET_KEY
try {
    if (-not [string]::IsNullOrWhiteSpace($settings["SUPABASE_URL"])) {
        $env:SUPABASE__URL = $settings["SUPABASE_URL"]
    }
    $env:SUPABASE_SECRET_KEY = $secretKey

    dotnet run --project "$PSScriptRoot/src/Estoque.Api/Estoque.Api.csproj" --urls http://localhost:5080
}
finally {
    if ($null -eq $previousUrl) {
        Remove-Item Env:SUPABASE__URL -ErrorAction SilentlyContinue
    } else {
        $env:SUPABASE__URL = $previousUrl
    }
    if ($null -eq $previousSecret) {
        Remove-Item Env:SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
    } else {
        $env:SUPABASE_SECRET_KEY = $previousSecret
    }
}