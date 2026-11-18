$ErrorActionPreference = "Stop"

$secureSecret = Read-Host "Cole a chave secreta Supabase (sb_secret_...)" -AsSecureString
$secretPointer = [IntPtr]::Zero

try {
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    $env:SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)

    if ([string]::IsNullOrWhiteSpace($env:SUPABASE_SECRET_KEY)) {
        throw "A chave não pode estar vazia."
    }

    dotnet run --project "$PSScriptRoot/src/Estoque.Api/Estoque.Api.csproj" --urls http://localhost:5080
}
finally {
    Remove-Item Env:SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
    $secureSecret.Dispose()
}