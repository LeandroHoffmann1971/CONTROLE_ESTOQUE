namespace Estoque.Infrastructure;

public sealed class SupabaseOptions
{
    public string Url { get; set; } = "";
    public string ServiceRoleKey { get; set; } = "";
}