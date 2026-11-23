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

    public async Task<IReadOnlyList<Estoque.Domain.User>> GetUsersAsync(CancellationToken cancellationToken) =>
        (await GetListAsync("users?select=id,name,cpf,created_at,status&order=id.asc", cancellationToken))
            .Select(Map).ToArray();

    public async Task<Estoque.Domain.User?> GetByIdAsync(long id, CancellationToken cancellationToken) =>
        (await GetListAsync($"users?id=eq.{id}&select=id,name,cpf,created_at,status", cancellationToken))
            .Select(Map).FirstOrDefault();

    public async Task<User?> GetByCpfAsync(string cpf, CancellationToken cancellationToken) =>
        (await GetListAsync($"users?cpf=eq.{Uri.EscapeDataString(cpf)}&select=*", cancellationToken))
            .Select(Map).FirstOrDefault();

    public async Task<Estoque.Domain.User> CreateAsync(Estoque.Domain.User user, CancellationToken cancellationToken)
    {
        try
        {
            return Map((await SendListAsync(HttpMethod.Post, "users", new
            {
                name = user.Name,
                cpf = user.Cpf,
                status = user.Status,
                password_hash = user.PasswordHash
            }, cancellationToken)).Single());
        }
        catch (HttpRequestException exception) when (exception.StatusCode == System.Net.HttpStatusCode.Conflict)
        {
            throw new InvalidOperationException("Já existe um usuário cadastrado com este CPF.", exception);
        }
    }

    private async Task<IReadOnlyList<SupabaseUser>> GetListAsync(string path, CancellationToken cancellationToken)
    {
        using var response = await http.GetAsync(path, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<List<SupabaseUser>>(JsonOptions, cancellationToken) ?? [];
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
        PasswordHash = user.PasswordHash
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
        [JsonPropertyName("password_hash")]
        public string PasswordHash { get; set; } = "";

    }
}
