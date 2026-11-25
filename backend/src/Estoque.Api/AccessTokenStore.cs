using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Estoque.Application;

namespace Estoque.Api;

public sealed record AuthenticatedUser(long Id, string Name, string Status);

public sealed class AccessTokenStore
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(8);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly byte[] signingKey;
    private readonly Dictionary<string, TokenSession> sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTimeOffset> revokedTokens = new(StringComparer.Ordinal);
    private readonly Lock gate = new();

    public AccessTokenStore(IConfiguration configuration)
    {
        var configuredKey = configuration["Auth:SigningKey"]
            ?? configuration["SUPABASE_SECRET_KEY"]
            ?? configuration["SUPABASE_SERVICE_ROLE_KEY"]
            ?? configuration["Supabase:SecretKey"]
            ?? configuration["Supabase:ServiceRoleKey"];
        if (string.IsNullOrWhiteSpace(configuredKey) || Encoding.UTF8.GetByteCount(configuredKey) < 32)
            throw new InvalidOperationException("Configure Auth:SigningKey com pelo menos 32 bytes ou uma chave secreta do Supabase.");

        signingKey = Encoding.UTF8.GetBytes(configuredKey);
    }

    public (string Token, DateTimeOffset ExpiresAt) Create(UserResponse user)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(TokenLifetime);
        var payload = new TokenPayload(
            new AuthenticatedUser(user.Id, user.Name, user.Status),
            expiresAt.ToUnixTimeSeconds(),
            Base64UrlEncode(RandomNumberGenerator.GetBytes(16)));
        var header = Base64UrlEncode(Encoding.UTF8.GetBytes("""{"alg":"HS256","typ":"JWT"}"""));
        var encodedPayload = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions));
        var unsignedToken = $"{header}.{encodedPayload}";
        var signature = HMACSHA256.HashData(signingKey, Encoding.ASCII.GetBytes(unsignedToken));
        var token = $"{unsignedToken}.{Base64UrlEncode(signature)}";

        lock (gate)
        {
            RemoveExpiredTokens();
            sessions[payload.TokenId] = new TokenSession(user.Id, expiresAt);
        }
        return (token, expiresAt);
    }

    public bool TryGetUser(string token, out AuthenticatedUser? user)
    {
        if (TryReadPayload(token, out var payload) &&
            DateTimeOffset.FromUnixTimeSeconds(payload.ExpiresAt) > DateTimeOffset.UtcNow)
        {
            lock (gate)
            {
                RemoveExpiredTokens();
                if (!revokedTokens.ContainsKey(payload.TokenId))
                {
                    user = payload.User;
                    return true;
                }
            }
        }

        user = null;
        return false;
    }

    public void Revoke(string token)
    {
        if (!TryReadPayload(token, out var payload))
            return;

        lock (gate)
        {
            if (DateTimeOffset.FromUnixTimeSeconds(payload.ExpiresAt) > DateTimeOffset.UtcNow)
                revokedTokens[payload.TokenId] = DateTimeOffset.FromUnixTimeSeconds(payload.ExpiresAt);
            sessions.Remove(payload.TokenId);
        }
    }

    public void RevokeUser(long userId)
    {
        lock (gate)
        {
            foreach (var (tokenId, session) in sessions.Where(item => item.Value.UserId == userId).ToArray())
            {
                revokedTokens[tokenId] = session.ExpiresAt;
                sessions.Remove(tokenId);
            }
        }
    }

    private bool TryReadPayload(string token, out TokenPayload payload)
    {
        payload = null!;
        var parts = token.Split('.');
        if (parts.Length != 3)
            return false;

        try
        {
            var unsignedToken = $"{parts[0]}.{parts[1]}";
            var expectedSignature = HMACSHA256.HashData(signingKey, Encoding.ASCII.GetBytes(unsignedToken));
            var providedSignature = Base64UrlDecode(parts[2]);
            if (!CryptographicOperations.FixedTimeEquals(expectedSignature, providedSignature))
                return false;

            var parsedPayload = JsonSerializer.Deserialize<TokenPayload>(Base64UrlDecode(parts[1]), JsonOptions);
            if (parsedPayload?.User is null || string.IsNullOrEmpty(parsedPayload.TokenId))
                return false;

            payload = parsedPayload;
            return true;
        }
        catch (Exception exception) when (exception is FormatException or JsonException or ArgumentOutOfRangeException)
        {
            return false;
        }
    }

    private void RemoveExpiredTokens()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var tokenId in sessions.Where(item => item.Value.ExpiresAt <= now).Select(item => item.Key).ToArray())
            sessions.Remove(tokenId);
        foreach (var tokenId in revokedTokens.Where(item => item.Value <= now).Select(item => item.Key).ToArray())
            revokedTokens.Remove(tokenId);
    }

    private static string Base64UrlEncode(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        var paddingLength = normalized.Length % 4;
        normalized += paddingLength switch
        {
            0 => "",
            2 => "==",
            3 => "=",
            _ => throw new FormatException("Invalid Base64URL value.")
        };
        return Convert.FromBase64String(normalized);
    }

    private sealed record TokenPayload(AuthenticatedUser User, long ExpiresAt, string TokenId);
    private sealed record TokenSession(long UserId, DateTimeOffset ExpiresAt);
}
