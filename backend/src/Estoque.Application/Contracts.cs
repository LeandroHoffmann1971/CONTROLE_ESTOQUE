using Estoque.Domain;

namespace Estoque.Application;

public sealed record CreateProductRequest(string Name, decimal MinimumStock, decimal InitialStock);
public sealed record UpdateProductRequest(string Name, decimal MinimumStock);
public sealed record CreateMovementRequest(string Type, decimal Quantity, string? Reason, string? OperatorName);

public interface IStockRepository
{
    Task<IReadOnlyList<Product>> GetProductsAsync(CancellationToken cancellationToken);
    Task<Product?> GetProductAsync(Guid id, CancellationToken cancellationToken);
    Task<Product> CreateProductAsync(Product product, CancellationToken cancellationToken);
    Task<Product> UpdateProductAsync(Product product, CancellationToken cancellationToken);
    Task DeleteProductAsync(Guid id, CancellationToken cancellationToken);
    Task<IReadOnlyList<StockMovement>> GetMovementsAsync(Guid? productId, CancellationToken cancellationToken);
    Task<StockMovement> CreateMovementAsync(StockMovement movement, CancellationToken cancellationToken);
}

public sealed class StockService(IStockRepository repository)
{
    public Task<IReadOnlyList<Product>> GetProductsAsync(CancellationToken cancellationToken) => repository.GetProductsAsync(cancellationToken);

    public async Task<Product> CreateProductAsync(CreateProductRequest request, CancellationToken cancellationToken)
    {
        ValidateProduct(request.Name, request.MinimumStock);
        if (request.InitialStock < 0) throw new ArgumentException("O estoque inicial não pode ser negativo.");
        return await repository.CreateProductAsync(new Product
        {
            Id = Guid.NewGuid(), Name = request.Name.Trim(),
            MinimumStock = request.MinimumStock, CurrentStock = request.InitialStock
        }, cancellationToken);
    }

    public async Task<Product> UpdateProductAsync(Guid id, UpdateProductRequest request, CancellationToken cancellationToken)
    {
        ValidateProduct(request.Name, request.MinimumStock);
        var product = await repository.GetProductAsync(id, cancellationToken) ?? throw new KeyNotFoundException("Produto não encontrado.");
        product.Name = request.Name.Trim();
        product.MinimumStock = request.MinimumStock;
        return await repository.UpdateProductAsync(product, cancellationToken);
    }

    public async Task DeleteProductAsync(Guid id, CancellationToken cancellationToken)
    {
        if (await repository.GetProductAsync(id, cancellationToken) is null) throw new KeyNotFoundException("Produto não encontrado.");
        await repository.DeleteProductAsync(id, cancellationToken);
    }

    public async Task<StockMovement> CreateMovementAsync(Guid productId, CreateMovementRequest request, CancellationToken cancellationToken)
    {
        if (request.Type is not ("entry" or "exit")) throw new ArgumentException("Tipo de movimentação inválido.");
        if (request.Quantity <= 0) throw new ArgumentException("A quantidade deve ser maior que zero.");
        if (request.Reason?.Length > 250) throw new ArgumentException("O motivo deve ter no máximo 250 caracteres.");
        if (request.OperatorName?.Length > 100) throw new ArgumentException("O operador deve ter no máximo 100 caracteres.");
        if (await repository.GetProductAsync(productId, cancellationToken) is null) throw new KeyNotFoundException("Produto não encontrado.");
        return await repository.CreateMovementAsync(new StockMovement
        {
            Id = Guid.NewGuid(), ProductId = productId, Type = request.Type, Quantity = request.Quantity,
            Reason = request.Reason?.Trim(), OperatorName = request.OperatorName?.Trim()
        }, cancellationToken);
    }

    public Task<IReadOnlyList<StockMovement>> GetMovementsAsync(Guid? productId, CancellationToken cancellationToken) => repository.GetMovementsAsync(productId, cancellationToken);

    private static void ValidateProduct(string name, decimal minimumStock)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length is < 3 or > 250) throw new ArgumentException("A descrição deve ter entre 3 e 250 caracteres.");
        if (minimumStock < 0) throw new ArgumentException("O estoque mínimo não pode ser negativo.");
    }
}