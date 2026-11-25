using Estoque.Domain;

namespace Estoque.Application;

public sealed record CreateProductRequest(string Name, decimal MinimumStock, decimal InitialStock, Guid? ClientOperationId = null, long? CreatedBy = null);
public sealed record UpdateProductRequest(string Name, decimal MinimumStock, bool? IsActive = null);
public sealed record CreateMovementRequest(string Type, decimal Quantity, string? Reason, string? OperatorName, Guid? ClientOperationId = null, long? CreatedBy = null);
public sealed record UpdateMovementRequest(string Type, decimal Quantity, string? Reason);
public sealed record StockMovementReportItem(
    Guid Id,
    Guid ProductId,
    string ProductName,
    string Type,
    decimal Quantity,
    decimal BalanceAfter,
    string? Reason,
    string? OperatorName,
    DateTimeOffset CreatedAt);

public interface IStockRepository
{
    Task<IReadOnlyList<Product>> GetProductsAsync(bool includeInactive, CancellationToken cancellationToken);
    Task<Product?> GetProductAsync(Guid id, bool includeInactive, CancellationToken cancellationToken);
    Task<Product> CreateProductAsync(Product product, CancellationToken cancellationToken);
    Task<Product> UpdateProductAsync(Product product, CancellationToken cancellationToken);
    Task<bool> DeleteProductAsync(Guid id, CancellationToken cancellationToken);
    Task<IReadOnlyList<StockMovementReportItem>> GetMovementsAsync(Guid? productId, DateTimeOffset? startAt, DateTimeOffset? endBefore, CancellationToken cancellationToken);
    Task<StockMovement> CreateMovementAsync(StockMovement movement, CancellationToken cancellationToken);
    Task<StockMovement> UpdateMovementAsync(Guid id, UpdateMovementRequest request, CancellationToken cancellationToken);
    Task DeleteMovementAsync(Guid id, CancellationToken cancellationToken);
}

public sealed class StockService(IStockRepository repository)
{
    public Task<IReadOnlyList<Product>> GetProductsAsync(CancellationToken cancellationToken, bool includeInactive = false) =>
        repository.GetProductsAsync(includeInactive, cancellationToken);

    public Task<Product?> GetProductAsync(Guid id, CancellationToken cancellationToken, bool includeInactive = false) =>
        repository.GetProductAsync(id, includeInactive, cancellationToken);

    public async Task<Product> CreateProductAsync(CreateProductRequest request, CancellationToken cancellationToken)
    {
        ValidateProduct(request.Name, request.MinimumStock);
        ValidateQuantity(request.InitialStock, "O estoque inicial");
        return await repository.CreateProductAsync(new Product
        {
            Id = Guid.NewGuid(), Name = request.Name.Trim(),
            MinimumStock = request.MinimumStock, CurrentStock = request.InitialStock,
            IsActive = true, ClientOperationId = request.ClientOperationId,
            CreatedBy = request.CreatedBy
        }, cancellationToken);
    }

    public async Task<Product> UpdateProductAsync(Guid id, UpdateProductRequest request, CancellationToken cancellationToken)
    {
        ValidateProduct(request.Name, request.MinimumStock);
        var product = await repository.GetProductAsync(id, true, cancellationToken) ?? throw new KeyNotFoundException("Produto não encontrado.");
        product.Name = request.Name.Trim();
        product.MinimumStock = request.MinimumStock;
        if (request.IsActive.HasValue) product.IsActive = request.IsActive.Value;
        return await repository.UpdateProductAsync(product, cancellationToken);
    }

    public async Task<bool> DeleteProductAsync(Guid id, CancellationToken cancellationToken)
    {
        if (await repository.GetProductAsync(id, false, cancellationToken) is null) throw new KeyNotFoundException("Produto não encontrado.");
        return await repository.DeleteProductAsync(id, cancellationToken);
    }

    public async Task<StockMovement> CreateMovementAsync(Guid productId, CreateMovementRequest request, CancellationToken cancellationToken)
    {
        ValidateMovement(request.Type, request.Quantity, request.Reason, request.OperatorName);
        var product = await repository.GetProductAsync(productId, false, cancellationToken)
            ?? throw new KeyNotFoundException("Produto não encontrado ou inativo.");
        if (request.Type == "exit" && request.Quantity > product.CurrentStock)
            throw new ArgumentException("A quantidade de saída não pode ser maior que o saldo disponível.");
        return await repository.CreateMovementAsync(new StockMovement
        {
            Id = Guid.NewGuid(), ProductId = productId, Type = request.Type, Quantity = request.Quantity,
            Reason = request.Reason?.Trim(), OperatorName = request.OperatorName?.Trim(),
            IsActive = true, ClientOperationId = request.ClientOperationId,
            CreatedBy = request.CreatedBy
        }, cancellationToken);
    }

    public Task<IReadOnlyList<StockMovementReportItem>> GetMovementsAsync(Guid? productId, DateTimeOffset? startAt, DateTimeOffset? endBefore, CancellationToken cancellationToken)
    {
        if (startAt.HasValue && endBefore.HasValue && startAt > endBefore)
            throw new ArgumentException("A Data de Início deve ser menor ou igual à Data de Término.");
        return repository.GetMovementsAsync(productId, startAt, endBefore, cancellationToken);
    }

    public async Task<StockMovement> UpdateMovementAsync(Guid id, UpdateMovementRequest request, CancellationToken cancellationToken)
    {
        ValidateMovement(request.Type, request.Quantity, request.Reason, null);
        return await repository.UpdateMovementAsync(id, request, cancellationToken);
    }

    public Task DeleteMovementAsync(Guid id, CancellationToken cancellationToken) => repository.DeleteMovementAsync(id, cancellationToken);

    private static void ValidateMovement(string type, decimal quantity, string? reason, string? operatorName)
    {
        if (type is not ("entry" or "exit")) throw new ArgumentException("Tipo de movimentação inválido.");
        ValidateQuantity(quantity, "A quantidade", allowZero: false);
        if (reason?.Length > 250) throw new ArgumentException("O motivo deve ter no máximo 250 caracteres.");
        if (operatorName?.Length > 150) throw new ArgumentException("O operador deve ter no máximo 150 caracteres.");
    }

    private static void ValidateProduct(string name, decimal minimumStock)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length is < 3 or > 250) throw new ArgumentException("A descrição deve ter entre 3 e 250 caracteres.");
        ValidateQuantity(minimumStock, "O estoque mínimo");
    }

    private static void ValidateQuantity(decimal value, string field, bool allowZero = true)
    {
        if (value < 0 || (!allowZero && value == 0))
            throw new ArgumentException($"{field} deve ser {(allowZero ? "maior ou igual a zero" : "maior que zero")}.");
        if (value > 999_999_999.999m || decimal.Round(value, 3) != value)
            throw new ArgumentException($"{field} deve respeitar numeric(12,3).");
    }
}