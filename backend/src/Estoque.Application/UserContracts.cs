using System.Security.Cryptography;
using System.Text;
using Estoque.Domain;

namespace Estoque.Application;

/// <summary>Dados para cadastrar um usuário.</summary>
public sealed record CreateUserRequest(string Name, string Cpf, string Status, string Password);

/// <summary>Dados editáveis de um usuário.</summary>
public sealed record UpdateUserRequest(string Name, string Cpf, string Status, string? Password);

/// <summary>Dados para autenticar um usuário.</summary>
public sealed record LoginRequest(string Cpf, string Password);

/// <summary>Dados públicos do usuário autenticado.</summary>
public sealed record UserResponse(long Id, string Name, string Cpf, DateOnly CreatedAt, string Status);

/// <summary>Token de acesso e perfil retornados após o login.</summary>
public sealed record LoginResponse(string AccessToken, DateTimeOffset ExpiresAt, UserResponse User);

public interface IUserRepository
{
    Task<IReadOnlyList<User>> GetUsersAsync(CancellationToken cancellationToken);
    Task<User?> GetByIdAsync(long id, CancellationToken cancellationToken);
    Task<User?> GetByCpfAsync(string cpf, CancellationToken cancellationToken);
    Task<User> CreateAsync(User user, CancellationToken cancellationToken);
    Task<User> UpdateAsync(User user, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(long id, CancellationToken cancellationToken);
}

public sealed class UserService(IUserRepository repository)
{
    private const int HashIterations = 100_000;

    public async Task<IReadOnlyList<UserResponse>> GetUsersAsync(CancellationToken cancellationToken) =>
        (await repository.GetUsersAsync(cancellationToken)).Select(ToResponse).ToArray();

    public async Task<UserResponse?> GetByIdAsync(long id, CancellationToken cancellationToken)
    {
        var user = await repository.GetByIdAsync(id, cancellationToken);
        return user is null ? null : ToResponse(user);
    }

    public async Task<UserResponse> CreateAsync(CreateUserRequest request, CancellationToken cancellationToken)
    {
        var name = request.Name?.Trim() ?? "";
        var cpf = NormalizeCpf(request.Cpf);
        var status = request.Status?.Trim().ToUpperInvariant() ?? "";
        ValidateDetails(name, cpf, status);
        ValidatePasswordAndReturn(request.Password);
        if (await repository.GetByCpfAsync(cpf, cancellationToken) is not null)
            throw new InvalidOperationException("Já existe um usuário cadastrado com este CPF.");

        var user = await repository.CreateAsync(new User
        {
            Name = name,
            Cpf = cpf,
            CreatedAt = DateOnly.FromDateTime(DateTime.UtcNow),
            Status = status,
            PasswordHash = HashPassword(request.Password)
        }, cancellationToken);
        return ToResponse(user);
    }

    public async Task<UserResponse> UpdateAsync(long id, UpdateUserRequest request, CancellationToken cancellationToken)
    {
        var user = await repository.GetByIdAsync(id, cancellationToken)
            ?? throw new KeyNotFoundException("Usuário não encontrado.");
        var name = request.Name?.Trim() ?? "";
        var cpf = NormalizeCpf(request.Cpf);
        var status = request.Status?.Trim().ToUpperInvariant() ?? "";
        ValidateDetails(name, cpf, status);

        var cpfOwner = await repository.GetByCpfAsync(cpf, cancellationToken);
        if (cpfOwner is not null && cpfOwner.Id != id)
            throw new InvalidOperationException("Já existe um usuário cadastrado com este CPF.");

        if (user.Status == "GERENTE" && status != "GERENTE" &&
            await CountManagersAsync(cancellationToken) <= 1)
            throw new InvalidOperationException("O sistema precisa manter pelo menos um gerente.");

        if (!string.IsNullOrEmpty(request.Password))
            user.PasswordHash = HashPassword(ValidatePasswordAndReturn(request.Password));
        user.Name = name;
        user.Cpf = cpf;
        user.Status = status;
        return ToResponse(await repository.UpdateAsync(user, cancellationToken));
    }

    public async Task DeleteAsync(long id, long currentUserId, CancellationToken cancellationToken)
    {
        if (id == currentUserId)
            throw new InvalidOperationException("Não é possível excluir o usuário conectado.");
        var user = await repository.GetByIdAsync(id, cancellationToken)
            ?? throw new KeyNotFoundException("Usuário não encontrado.");
        if (user.Status == "GERENTE" && await CountManagersAsync(cancellationToken) <= 1)
            throw new InvalidOperationException("O sistema precisa manter pelo menos um gerente.");
        if (!await repository.DeleteAsync(id, cancellationToken))
            throw new KeyNotFoundException("Usuário não encontrado.");
    }

    public async Task<UserResponse?> AuthenticateAsync(LoginRequest request, CancellationToken cancellationToken)
    {
        var cpf = NormalizeCpf(request.Cpf);
        if (!IsValidCpf(cpf) || string.IsNullOrEmpty(request.Password))
            return null;
        var user = await repository.GetByCpfAsync(cpf, cancellationToken);
        if (user is null || !VerifyPassword(request.Password, user.PasswordHash))
            return null;
        return ToResponse(user);
    }

    public static string NormalizeCpf(string? cpf)
    {
        var value = cpf ?? "";
        if (value.Any(character => !char.IsAsciiDigit(character) &&
            character is not ('.' or '-') && !char.IsWhiteSpace(character)))
            return "";
        var digits = new string(value.Where(char.IsAsciiDigit).ToArray());
        return digits.Length == 11
            ? $"{digits[..3]}.{digits[3..6]}.{digits[6..9]}-{digits[9..]}"
            : "";
    }

    private static void ValidateName(string name)
    {
        if (name.Length < 3)
            throw new ArgumentException("O nome deve ter pelo menos 3 caracteres.");
        if (name.Length > 150)
            throw new ArgumentException("O nome deve ter no máximo 150 caracteres.");
    }

    private static string ValidatePasswordAndReturn(string? password)
    {
        if (password is null || password.Length != 6 || password.Any(character => !char.IsAsciiLetterOrDigit(character)))
            throw new ArgumentException("A senha deve conter exatamente 6 caracteres alfanuméricos.");
        return password;
    }

    private static void ValidateDetails(string name, string cpf, string status)
    {
        ValidateName(name);
        if (!IsValidCpf(cpf))
            throw new ArgumentException("Informe um CPF válido.");
        if (status is not ("GERENTE" or "COLABORADOR"))
            throw new ArgumentException("Selecione GERENTE ou COLABORADOR.");
    }

    private async Task<int> CountManagersAsync(CancellationToken cancellationToken) =>
        (await repository.GetUsersAsync(cancellationToken)).Count(user => user.Status == "GERENTE");

    private static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, HashIterations, HashAlgorithmName.SHA256, 32);
        return FormatHash(salt, hash);
    }

    private static bool IsValidCpf(string cpf)
    {
        var digits = new string(cpf.Where(char.IsDigit).ToArray());
        if (digits.Length != 11 || digits.All(character => character == digits[0]))
            return false;
        var numbers = digits.Select(character => character - '0').ToArray();
        for (var position = 9; position <= 10; position++)
        {
            var sum = 0;
            for (var index = 0; index < position; index++)
                sum += numbers[index] * (position + 1 - index);
            var remainder = sum % 11;
            var expected = remainder < 2 ? 0 : 11 - remainder;
            if (numbers[position] != expected)
                return false;
        }
        return true;
    }

    private static string FormatHash(byte[] salt, byte[] hash) =>
        $"$pbkdf2-sha256${HashIterations}${Convert.ToHexString(salt).ToLowerInvariant()}${Convert.ToHexString(hash).ToLowerInvariant()}";

    private static bool VerifyPassword(string password, string encodedHash)
    {
        var parts = encodedHash.Split('$');
        if (parts.Length != 5 || parts[1] != "pbkdf2-sha256" ||
            !int.TryParse(parts[2], out var iterations) || iterations != HashIterations)
            return false;
        try
        {
            var salt = Convert.FromHexString(parts[3]);
            var expectedHash = Convert.FromHexString(parts[4]);
            if (salt.Length != 16 || expectedHash.Length != 32)
                return false;
            var actualHash = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, expectedHash.Length);
            return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static UserResponse ToResponse(User user) =>
        new(user.Id, user.Name, user.Cpf, user.CreatedAt, user.Status);
}
