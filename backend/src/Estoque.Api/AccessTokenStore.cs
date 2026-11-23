using System.Security.Cryptography;
using Estoque.Application;

namespace Estoque.Api;

public sealed class AccessTokenStore
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(8);
    private readonly Dictionary<string, TokenSession> sessions = new(StringComparer.Ordinal);
    private readonly Lock gate = new();

    public (string Token, DateTimeOffset ExpiresAt) Create(UserResponse user)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expiresAt = DateTimeOffset.UtcNow.Add(TokenLifetime);
        lock (gate)
        {
            RemoveExpiredTokens();
            sessions[token] = new TokenSession(user, expiresAt);
        }
        return (token, expiresAt);
    }

    public bool TryGetUser(string token, out UserResponse? user)
    {
        lock (gate)
        {
            if (sessions.TryGetValue(token, out var session) && session.ExpiresAt > DateTimeOffset.UtcNow)
            {
                user = session.User;
                return true;
            }
            sessions.Remove(token);
        }
        user = null;
        return false;
    }

    public void Revoke(string token)
    {
        lock (gate)
            sessions.Remove(token);
    }

    public void RevokeUser(long userId)
    {
        lock (gate)
        {
            foreach (var token in sessions.Where(item => item.Value.User.Id == userId)
                         .Select(item => item.Key).ToArray())
                sessions.Remove(token);
        }
    }

    private void RemoveExpiredTokens()
    {
        foreach (var token in sessions.Where(item => item.Value.ExpiresAt <= DateTimeOffset.UtcNow)
                     .Select(item => item.Key).ToArray())
            sessions.Remove(token);
    }

    private sealed record TokenSession(UserResponse User, DateTimeOffset ExpiresAt);
}
