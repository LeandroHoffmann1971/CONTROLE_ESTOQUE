$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$envFile = Join-Path $projectRoot ".env"
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

    $value = $matches.value.Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $settings[$matches.name] = $value
}

$supabaseUrl = ([string]$settings["SUPABASE_URL"]).TrimEnd("/")
$secretKey = $settings["SUPABASE_SECRET_KEY"]
if ([string]::IsNullOrWhiteSpace($secretKey)) {
    $secretKey = $settings["SUPABASE_SERVICE_ROLE_KEY"]
}
$name = ([string]$settings["INITIAL_MANAGER_NAME"]).Trim()
$cpfDigits = [string]$settings["INITIAL_MANAGER_CPF"] -replace '\D', ''
$password = [string]$settings["INITIAL_MANAGER_PASSWORD"]

function Test-CpfDigits {
    param([string]$Digits)

    if ($Digits -notmatch '^\d{11}$' -or $Digits -match '^(\d)\1{10}$') {
        return $false
    }

    for ($position = 9; $position -le 10; $position++) {
        $sum = 0
        for ($index = 0; $index -lt $position; $index++) {
            $sum += [int]::Parse($Digits.Substring($index, 1)) * ($position + 1 - $index)
        }
        $remainder = $sum % 11
        $expected = if ($remainder -lt 2) { 0 } else { 11 - $remainder }
        if ([int]::Parse($Digits.Substring($position, 1)) -ne $expected) {
            return $false
        }
    }

    return $true
}

function ConvertTo-HexString {
    param([byte[]]$Bytes)

    return [System.BitConverter]::ToString($Bytes).Replace("-", "").ToLowerInvariant()
}

if ([string]::IsNullOrWhiteSpace($supabaseUrl) -or [string]::IsNullOrWhiteSpace($secretKey)) {
    throw "Configure SUPABASE_URL e SUPABASE_SECRET_KEY no arquivo .env."
}
if ($supabaseUrl -match 'YOUR_PROJECT_ID' -or $secretKey -match '^replace_with_') {
    throw "Substitua os valores de exemplo do Supabase no arquivo .env."
}
if ($name.Length -lt 3) {
    throw "INITIAL_MANAGER_NAME deve conter ao menos 3 caracteres."
}
if (-not (Test-CpfDigits $cpfDigits)) {
    throw "INITIAL_MANAGER_CPF deve conter um CPF válido."
}
if ($password -notmatch '^[A-Za-z0-9]{6}$') {
    throw "INITIAL_MANAGER_PASSWORD deve ter 6 caracteres alfanuméricos."
}

$headers = @{
    apikey = $secretKey
    Authorization = "Bearer $secretKey"
}
$managerCheck = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/users?select=id&status=eq.GERENTE&limit=1" -Headers $headers
if (@($managerCheck).Count -gt 0) {
    throw "Já existe um gerente cadastrado. O bootstrap inicial não foi executado."
}

$salt = [byte[]]::new(16)
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $random.GetBytes($salt)
}
finally {
    $random.Dispose()
}
$derive = [System.Security.Cryptography.Rfc2898DeriveBytes]::new(
    [System.Text.Encoding]::UTF8.GetBytes($password),
    $salt,
    100000,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256
)
$hash = $derive.GetBytes(32)
$derive.Dispose()
$encodedHash = '$pbkdf2-sha256$100000$' +
    (ConvertTo-HexString $salt) + '$' +
    (ConvertTo-HexString $hash)
$formattedCpf = "{0}.{1}.{2}-{3}" -f $cpfDigits.Substring(0, 3), $cpfDigits.Substring(3, 3), $cpfDigits.Substring(6, 3), $cpfDigits.Substring(9, 2)
$body = @{
    name = $name
    cpf = $formattedCpf
    status = "GERENTE"
    password_hash = $encodedHash
} | ConvertTo-Json -Compress

$headers["Prefer"] = "return=minimal"
Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/users" -Method Post -Headers $headers -ContentType "application/json" -Body $body | Out-Null
Write-Output "Gerente inicial cadastrado com sucesso."

