using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Estoque.Application;
using Estoque.Domain;

namespace Estoque.Infrastructure;

public sealed class SupabaseUserRepository : IUserRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient http;

    public SupabaseUserRepository(HttpClient http, SupabaseOptions settings)
    {
        if (!Uri.TryCreate(settings.Url, UriKind.Absolute, out var baseUri) || string.IsNullOrWhiteSpace(settings.ServiceRoleKey))
            throw new InvalidOperationException("Configure Supabase:Url e SUPABASE_SECRET_KEY no servidor.");

        this.http = http;
        this.http.BaseAddress = new Uri(baseUri, "rest/v1/");
        this.http.DefaultRequestHeaders.Add("apikey", settings.ServiceRoleKey);
        if (!settings.ServiceRoleKey.StartsWith("sb_secret_", StringComparison.Ordinal))
            this.http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", settings.ServiceRoleKey);
    }

    public async Task<IReadOnlyList<Estoque.Domain.User>> GetUsersAsync(bool includeInactive, CancellationToken cancellationToken) =>
        (await GetListAsync<SupabaseUser>($"users?select=id,name,cpf,created_at,status,is_active&{(includeInactive ? "" : "is_active=eq.true&")}order=id.asc", cancellationToken))
            .Select(Map).ToArray();

    public async Task<Estoque.Domain.User?> GetByIdAsync(long id, bool includeInactive, CancellationToken cancellationToken) =>
        (await GetListAsync<SupabaseUser>($"users?id=eq.{id}&select=*&{(includeInactive ? "" : "is_active=eq.true&")}", cancellationToken))
            .Select(Map).FirstOrDefault();

    public async Task<User?> GetByCpfAsync(string cpf, CancellationToken cancellationToken) =>
        (await GetListAsync<SupabaseUser>($"users?cpf=eq.{Uri.EscapeDataString(cpf)}&select=*", cancellationToken))
            .Select(Map).FirstOrDefault();

    public async Task<bool> RecordLoginAttemptAsync(
        long? userId, string cpfHash, bool success, string? ip, string? userAgent, CancellationToken cancellationToken)
    {
        using var response = await http.PostAsJsonAsync("rpc/record_login_attempt", new
        {
            p_user_id = userId,
            p_cpf_hash = cpfHash,
            p_success = success,
            p_ip = ip,
            p_user_agent = userAgent
        }, JsonOptions, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<bool>(JsonOptions, cancellationToken);
    }

    public async Task<Estoque.Domain.User> CreateAsync(Estoque.Domain.User user, CancellationToken cancellationToken)
    {
        try
        {
            return Map((await SendListAsync(HttpMethod.Post, "users", new
            {
                name = user.Name,
                cpf = user.Cpf,
                status = user.Status,
                password_hash = user.PasswordHash,
                is_active = user.IsActive
            }, cancellationToken)).Single());
        }
        catch (HttpRequestException exception) when (exception.StatusCode == System.Net.HttpStatusCode.Conflict)
        {
            throw new InvalidOperationException("Já existe um usuário cadastrado com este CPF.", exception);
        }
    }

    public async Task<Estoque.Domain.User> UpdateAsync(Estoque.Domain.User user, CancellationToken cancellationToken)
    {
        try
        {
            var updated = await SendListAsync(HttpMethod.Patch, $"users?id=eq.{user.Id}", new
            {
                name = user.Name,
                cpf = user.Cpf,
                status = user.Status,
                password_hash = user.PasswordHash,
                is_active = user.IsActive
            }, cancellationToken);
            return updated.Count == 0
                ? throw new KeyNotFoundException("Usuário não encontrado.")
                : Map(updated.Single());
        }
        catch (HttpRequestException exception) when (exception.StatusCode == System.Net.HttpStatusCode.Conflict)
        {
            throw new InvalidOperationException("Já existe um usuário cadastrado com este CPF.", exception);
        }
    }

    public async Task<bool?> DeleteAsync(long id, CancellationToken cancellationToken)
    {
        var history = await GetListAsync<Guid>($"stock_movements?created_by=eq.{id}&select=id&limit=1", cancellationToken);
        if (history.Count > 0)
        {
            using var update = new HttpRequestMessage(HttpMethod.Patch, $"users?id=eq.{id}")
            {
                Content = new StringContent("{\"is_active\":false}", Encoding.UTF8, "application/json")
            };
            using var updateResponse = await http.SendAsync(update, cancellationToken);
            await EnsureSuccessAsync(updateResponse, cancellationToken);
            return true;
        }
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"users?id=eq.{id}&select=id");
        request.Headers.Add("Prefer", "return=representation");
        using var response = await http.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        var deleted = await response.Content.ReadFromJsonAsync<List<SupabaseUser>>(JsonOptions, cancellationToken) ?? [];
        return deleted.Count == 0 ? null : false;
    }

    private async Task<IReadOnlyList<T>> GetListAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var response = await http.GetAsync(path, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<List<T>>(JsonOptions, cancellationToken) ?? [];
    }

    private async Task<IReadOnlyList<SupabaseUser>> SendListAsync(HttpMethod method, string path, object payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json")
        };
        request.Headers.Add("Prefer", "return=representation");
        using var response = await http.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<List<SupabaseUser>>(JsonOptions, cancellationToken) ?? [];
    }

    private static Estoque.Domain.User Map(SupabaseUser user) => new()
    {
        Id = user.Id,
        Name = user.Name,
        Cpf = user.Cpf,
        CreatedAt = user.CreatedAt,
        Status = user.Status,
        PasswordHash = user.PasswordHash,
        IsActive = user.IsActive
    };

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
            return;
        var details = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new HttpRequestException($"Supabase respondeu {(int)response.StatusCode}: {details}", null, response.StatusCode);
    }

    private sealed class SupabaseUser
    {
        [JsonPropertyName("id")]
        public long Id { get; set; }
        [JsonPropertyName("name")]
        public string Name { get; set; } = "";
        [JsonPropertyName("cpf")]
        public string Cpf { get; set; } = "";
        [JsonPropertyName("created_at")]
        public DateOnly CreatedAt { get; set; }
        [JsonPropertyName("status")]
        public string Status { get; set; } = "";
        [JsonPropertyName("is_active")]
        public bool IsActive { get; set; } = true;
        [JsonPropertyName("password_hash")]
        public string PasswordHash { get; set; } = "";

    }
}
