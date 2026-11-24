using System.Text.Json.Serialization;

namespace Estoque.Domain;

public sealed class StockMovement
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

    [JsonPropertyName("is_active")]
    public bool IsActive { get; set; } = true;

    [JsonPropertyName("client_operation_id")]
    public Guid? ClientOperationId { get; set; }

    [JsonPropertyName("created_by")]
    public long? CreatedBy { get; set; }
}