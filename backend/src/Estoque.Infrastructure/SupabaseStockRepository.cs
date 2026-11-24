using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Estoque.Application;
using Estoque.Domain;

namespace Estoque.Infrastructure;

public sealed class SupabaseStockRepository : IStockRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http;

    public SupabaseStockRepository(HttpClient http, SupabaseOptions settings)
    {
        if (!Uri.TryCreate(settings.Url, UriKind.Absolute, out var baseUri) || string.IsNullOrWhiteSpace(settings.ServiceRoleKey))
            throw new InvalidOperationException("Configure Supabase:Url e SUPABASE_SECRET_KEY no servidor (ou SUPABASE_SERVICE_ROLE_KEY legado).");

        _http = http;
        _http.BaseAddress = new Uri(baseUri, "rest/v1/");
        _http.DefaultRequestHeaders.Add("apikey", settings.ServiceRoleKey);
        if (!settings.ServiceRoleKey.StartsWith("sb_secret_", StringComparison.Ordinal))
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", settings.ServiceRoleKey);
    }

    public Task<IReadOnlyList<Product>> GetProductsAsync(bool includeInactive, CancellationToken token) =>
        GetListAsync<Product>($"products?select=*&{(includeInactive ? "" : "is_active=eq.true&")}order=name.asc", token);

    public async Task<Product?> GetProductAsync(Guid id, bool includeInactive, CancellationToken token) =>
        (await GetListAsync<Product>($"products?id=eq.{id}&select=*&{(includeInactive ? "" : "is_active=eq.true&")}", token)).FirstOrDefault();

    public async Task<Product> CreateProductAsync(Product product, CancellationToken token)
    {
        if (product.ClientOperationId.HasValue)
        {
            var existing = await GetListAsync<Product>($"products?client_operation_id=eq.{product.ClientOperationId}&select=*", token);
            if (existing.Count > 0) return existing[0];
        }
        try
        {
            return (await SendListAsync<Product>(HttpMethod.Post, "products", new
        {
            id = product.Id,
            name = product.Name,
            minimum_stock = product.MinimumStock,
            current_stock = product.CurrentStock,
            client_operation_id = product.ClientOperationId,
            created_by = product.CreatedBy
            }, token)).Single();
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.Conflict && product.ClientOperationId.HasValue)
        {
            var existing = await GetListAsync<Product>($"products?client_operation_id=eq.{product.ClientOperationId}&select=*", token);
            if (existing.Count > 0) return existing[0];
            throw;
        }
    }

    public async Task<Product> UpdateProductAsync(Product product, CancellationToken token) =>
        (await SendListAsync<Product>(HttpMethod.Patch, $"products?id=eq.{product.Id}", new
        {
            name = product.Name,
            minimum_stock = product.MinimumStock,
            is_active = product.IsActive,
            updated_at = DateTimeOffset.UtcNow
        }, token)).Single();

    public async Task<bool> DeleteProductAsync(Guid id, CancellationToken token)
    {
        var history = await GetListAsync<Guid>($"stock_movements?product_id=eq.{id}&select=id&limit=1", token);
        if (history.Count > 0)
        {
            using var update = new HttpRequestMessage(HttpMethod.Patch, $"products?id=eq.{id}")
            {
                Content = new StringContent("{\"is_active\":false}", Encoding.UTF8, "application/json")
            };
            using var updateResponse = await _http.SendAsync(update, token);
            await EnsureSuccessAsync(updateResponse, token);
            return true;
        }
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"products?id=eq.{id}");
        using var response = await _http.SendAsync(request, token);
        await EnsureSuccessAsync(response, token);
        return false;
    }

    public async Task<IReadOnlyList<StockMovementReportItem>> GetMovementsAsync(Guid? productId, CancellationToken token)
    {
        var filter = productId.HasValue ? $"&product_id=eq.{productId}" : "";
        const int pageSize = 1000;
        var movements = new List<StockMovementReportItem>();
        var offset = 0;
        List<MovementResponse> page;

        do
        {
            page = (await GetListAsync<MovementResponse>(
                $"stock_movements?select=*,products!inner(name,is_active)&is_active=eq.true&products.is_active=eq.true&order=created_at.desc&limit={pageSize}&offset={offset}{filter}",
                token)).ToList();
            movements.AddRange(page.Select(movement =>
            {
                var product = movement.Product
                    ?? throw new InvalidOperationException("Produto não encontrado para a movimentação.");
                return new StockMovementReportItem(
                    movement.Id, movement.ProductId, product.Name, movement.Type, movement.Quantity,
                    movement.BalanceAfter, movement.Reason, movement.OperatorName, movement.CreatedAt);
            }));
            offset += pageSize;
        } while (page.Count == pageSize);

        return movements;
    }

    public async Task<StockMovement> CreateMovementAsync(StockMovement movement, CancellationToken token)
    {
        if (movement.ClientOperationId.HasValue)
        {
            var existing = await GetListAsync<StockMovement>(
                $"stock_movements?client_operation_id=eq.{movement.ClientOperationId}&select=*", token);
            if (existing.Count > 0) return existing[0];
        }
        try
        {
            return (await SendListAsync<StockMovement>(HttpMethod.Post, "stock_movements", new
        {
            id = movement.Id,
            product_id = movement.ProductId,
            type = movement.Type,
            quantity = movement.Quantity,
            reason = movement.Reason,
            operator_name = movement.OperatorName,
            client_operation_id = movement.ClientOperationId,
            created_by = movement.CreatedBy
            }, token)).Single();
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.Conflict && movement.ClientOperationId.HasValue)
        {
            var existing = await GetListAsync<StockMovement>(
                $"stock_movements?client_operation_id=eq.{movement.ClientOperationId}&select=*", token);
            if (existing.Count > 0) return existing[0];
            throw;
        }
    }

    private async Task<IReadOnlyList<T>> GetListAsync<T>(string path, CancellationToken token)
    {
        using var response = await _http.GetAsync(path, token);
        await EnsureSuccessAsync(response, token);
        return await response.Content.ReadFromJsonAsync<List<T>>(JsonOptions, token) ?? [];
    }

    private async Task<IReadOnlyList<T>> SendListAsync<T>(HttpMethod method, string path, object payload, CancellationToken token)
    {
        using var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json")
        };
        request.Headers.Add("Prefer", "return=representation");
        using var response = await _http.SendAsync(request, token);
        await EnsureSuccessAsync(response, token);
        return await response.Content.ReadFromJsonAsync<List<T>>(JsonOptions, token) ?? [];
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken token)
    {
        if (response.IsSuccessStatusCode) return;
        var details = await response.Content.ReadAsStringAsync(token);
        var message = $"Supabase respondeu {(int)response.StatusCode}: {details}";
        if (response.StatusCode == HttpStatusCode.NotFound)
            throw new InvalidOperationException("Recurso Supabase não encontrado. Em instalação existente, execute as migrações 001 e 002; em instalação nova, execute schema.sql.");
        throw new HttpRequestException(message, null, response.StatusCode);
    }

    private sealed class MovementResponse
    {
        [JsonPropertyName("id")]
        public Guid Id { get; set; }

        [JsonPropertyName("product_id")]
        public Guid ProductId { get; set; }

        [JsonPropertyName("type")]
        public string Type { get; set; } = "";

        [JsonPropertyName("quantity")]
        public decimal Quantity { get; set; }

        [JsonPropertyName("reason")]
        public string? Reason { get; set; }

        [JsonPropertyName("operator_name")]
        public string? OperatorName { get; set; }

        [JsonPropertyName("created_at")]
        public DateTimeOffset CreatedAt { get; set; }

        [JsonPropertyName("balance_after")]
        public decimal BalanceAfter { get; set; }

        [JsonPropertyName("products")]
        public MovementProduct? Product { get; set; }
    }

    private sealed class MovementProduct
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = "";

        [JsonPropertyName("is_active")]
        public bool IsActive { get; set; }
    }
}