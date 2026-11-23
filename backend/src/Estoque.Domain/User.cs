namespace Estoque.Domain;

public sealed class User
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string Cpf { get; set; } = "";
    public DateOnly CreatedAt { get; set; }
    public string Status { get; set; } = "";
    public string PasswordHash { get; set; } = "";
}
