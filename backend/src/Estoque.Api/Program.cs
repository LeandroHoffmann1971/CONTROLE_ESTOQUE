using Estoque.Application;
using Estoque.Infrastructure;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var supabase = new SupabaseOptions
{
	Url = builder.Configuration["Supabase:Url"] ?? "https://oaukruzqhijxgvjlyyqk.supabase.co",
	ServiceRoleKey = builder.Configuration["Supabase:SecretKey"]
		?? builder.Configuration["SUPABASE_SECRET_KEY"]
		?? builder.Configuration["Supabase:ServiceRoleKey"]
		?? builder.Configuration["SUPABASE_SERVICE_ROLE_KEY"]
		?? ""
};

builder.Services.AddSingleton(supabase);
builder.Services.AddHttpClient<IStockRepository, SupabaseStockRepository>();
builder.Services.AddScoped<StockService>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
	policy.WithOrigins(builder.Configuration["Frontend:Origin"] ?? "http://localhost:5500")
		.AllowAnyHeader()
		.AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
var frontendRoot = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "..", "..", "frontend", "wwwroot"));
var frontendFiles = new PhysicalFileProvider(frontendRoot);
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = frontendFiles });
app.UseStaticFiles(new StaticFileOptions { FileProvider = frontendFiles });
app.Use(async (context, next) =>
{
	try
	{
		await next();
	}
	catch (ArgumentException exception)
	{
		await Results.BadRequest(new { error = exception.Message }).ExecuteAsync(context);
	}
	catch (KeyNotFoundException exception)
	{
		await Results.NotFound(new { error = exception.Message }).ExecuteAsync(context);
	}
	catch (InvalidOperationException exception)
	{
		await Results.Problem(exception.Message, statusCode: StatusCodes.Status503ServiceUnavailable).ExecuteAsync(context);
	}
	catch (HttpRequestException exception)
	{
		app.Logger.LogError(exception, "Falha na comunicação com o Supabase");
		var status = exception.StatusCode == System.Net.HttpStatusCode.Conflict
			? StatusCodes.Status409Conflict
			: StatusCodes.Status502BadGateway;
		var detail = status == StatusCodes.Status409Conflict
			? "Produto já cadastrado"
			: "Não foi possível acessar o banco de dados.";
		await Results.Problem(detail, statusCode: status).ExecuteAsync(context);
	}
});

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/products", async (StockService service, CancellationToken token) => Results.Ok(await service.GetProductsAsync(token)));
app.MapPost("/api/products", async (CreateProductRequest request, StockService service, CancellationToken token) =>
	Results.Created("/api/products", await service.CreateProductAsync(request, token)));
app.MapPut("/api/products/{id:guid}", async (Guid id, UpdateProductRequest request, StockService service, CancellationToken token) =>
	Results.Ok(await service.UpdateProductAsync(id, request, token)));
app.MapDelete("/api/products/{id:guid}", async (Guid id, StockService service, CancellationToken token) =>
{
	await service.DeleteProductAsync(id, token);
	return Results.NoContent();
});
app.MapGet("/api/movements", async (Guid? productId, StockService service, CancellationToken token) => Results.Ok(await service.GetMovementsAsync(productId, token)));
app.MapPost("/api/products/{id:guid}/movements", async (Guid id, CreateMovementRequest request, StockService service, CancellationToken token) =>
	Results.Created("/api/movements", await service.CreateMovementAsync(id, request, token)));

app.Run();