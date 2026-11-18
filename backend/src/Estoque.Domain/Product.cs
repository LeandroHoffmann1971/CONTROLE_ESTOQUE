using System.Text.Json.Serialization;

namespace Estoque.Domain;

public sealed class Product
{
    [JsonPropertyName("id")]
    public Guid Id { get; set; }

    [JsonPropertyName("code")]
    public long Code { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("minimum_stock")]
    public decimal MinimumStock { get; set; }

    [JsonPropertyName("current_stock")]
    public decimal CurrentStock { get; set; }

    [JsonPropertyName("created_at")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; }
}