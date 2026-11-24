$ErrorActionPreference = "Stop"

$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env"
$settings = @{}
if (Test-Path -LiteralPath $envFile) {
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
}

$secretKey = $env:SUPABASE_SECRET_KEY
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    $secretKey = $env:SUPABASE_SERVICE_ROLE_KEY
}
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    $secretKey = $env:SUPABASE__SecretKey
}
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    $secretKey = $env:SUPABASE__ServiceRoleKey
}
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    $secretKey = $env:SUPABASE__Service_RoleKey
}
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    $secretKey = $settings["SUPABASE_SECRET_KEY"]
}
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    $secretKey = $settings["SUPABASE_SERVICE_ROLE_KEY"]
}
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    throw "Configure SUPABASE_SECRET_KEY no ambiente ou no arquivo .env antes de iniciar."
}
if ($secretKey -match '(?i)replace_with|your_.*key') {
    throw "Substitua o valor de exemplo por uma chave secreta válida do Supabase."
}

$supabaseUrl = $env:SUPABASE_URL
if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
    $supabaseUrl = $env:SUPABASE__URL
}
if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
    $supabaseUrl = $settings["SUPABASE_URL"]
}
if (-not [string]::IsNullOrWhiteSpace($supabaseUrl)) {
    $parsedSupabaseUrl = $null
    if ($supabaseUrl -match '(?i)YOUR_PROJECT_ID' -or
        -not [Uri]::TryCreate($supabaseUrl, [UriKind]::Absolute, [ref]$parsedSupabaseUrl) -or
        $parsedSupabaseUrl.Scheme -ne "https") {
        throw "SUPABASE_URL inválida. Configure a URL HTTPS real do seu projeto Supabase."
    }
}

$previousUrl = $env:SUPABASE__URL
$previousSecret = $env:SUPABASE_SECRET_KEY
try {
    if (-not [string]::IsNullOrWhiteSpace($supabaseUrl)) {
        $env:SUPABASE__URL = $supabaseUrl
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