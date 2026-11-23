using Estoque.Application;
using Estoque.Infrastructure;
using Estoque.Api;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var supabase = new SupabaseOptions
{
	Url = builder.Configuration["Supabase:Url"]
		?? builder.Configuration["SUPABASE_URL"]
		?? "https://oaukruzqhijxgvjlyyqk.supabase.co",
	ServiceRoleKey = builder.Configuration["Supabase:SecretKey"]
		?? builder.Configuration["SUPABASE_SECRET_KEY"]
		?? builder.Configuration["Supabase:ServiceRoleKey"]
		?? builder.Configuration["SUPABASE_SERVICE_ROLE_KEY"]
		?? ""
};

builder.Services.AddSingleton(supabase);
builder.Services.AddOpenApi();
builder.Services.AddHttpClient<IStockRepository, SupabaseStockRepository>();
builder.Services.AddHttpClient<IUserRepository, SupabaseUserRepository>();
builder.Services.AddScoped<StockService>();
builder.Services.AddScoped<UserService>();
builder.Services.AddSingleton<AccessTokenStore>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
	policy.WithOrigins(builder.Configuration["Frontend:Origin"] ?? "http://localhost:5500")
		.AllowAnyHeader()
		.AllowAnyMethod()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
	app.MapOpenApi();

app.UseCors();
var frontendRoot = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "..", "..", "frontend", "wwwroot"));
var frontendFiles = new PhysicalFileProvider(frontendRoot);
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = frontendFiles });
app.UseStaticFiles(new StaticFileOptions { FileProvider = frontendFiles });
app.Use(async (context, next) =>
{
	var path = context.Request.Path;
	if (!path.StartsWithSegments("/api") || path == "/api/health" ||
		path == "/api/auth/login" || HttpMethods.IsOptions(context.Request.Method))
	{
		await next();
		return;
	}

	var authorization = context.Request.Headers.Authorization.ToString();
	var token = authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
		? authorization["Bearer ".Length..].Trim()
		: "";
	var tokens = context.RequestServices.GetRequiredService<AccessTokenStore>();
	if (token.Length == 0 || !tokens.TryGetUser(token, out var user) || user is null)
	{
		context.Response.StatusCode = StatusCodes.Status401Unauthorized;
		await context.Response.WriteAsJsonAsync(new { title = "Não autenticado", status = 401, detail = "Faça login para continuar." });
		return;
	}

	var isMovementRegistration = HttpMethods.IsPost(context.Request.Method) &&
		System.Text.RegularExpressions.Regex.IsMatch(path, @"^/api/products/[0-9a-fA-F-]+/movements$");
	var isProductRead = HttpMethods.IsGet(context.Request.Method) && path == "/api/products";
	var isProductUpdate = HttpMethods.IsPut(context.Request.Method) &&
		System.Text.RegularExpressions.Regex.IsMatch(path, @"^/api/products/[0-9a-fA-F-]+$");
	var isLogout = HttpMethods.IsPost(context.Request.Method) && path == "/api/auth/logout";
	if (user.Status != "GERENTE" && !isMovementRegistration && !isProductRead && !isProductUpdate && !isLogout)
	{
		context.Response.StatusCode = StatusCodes.Status403Forbidden;
		await context.Response.WriteAsJsonAsync(new { title = "Acesso negado", status = 403, detail = "Esta operação está disponível apenas para gerentes." });
		return;
	}

	context.Items["authenticated-user"] = user;
	await next();
});
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
app.MapPost("/api/auth/login", async (LoginRequest request, UserService service, AccessTokenStore tokens, CancellationToken token) =>
{
	var user = await service.AuthenticateAsync(request, token);
	if (user is null)
		return Results.Unauthorized();
	var accessToken = tokens.Create(user);
	return Results.Ok(new LoginResponse(accessToken.Token, accessToken.ExpiresAt, user));
})
	.WithName("Login")
	.WithSummary("Autentica um usuário")
	.WithDescription("Valida CPF e senha e emite um token de acesso mantido em memória.");
app.MapPost("/api/auth/logout", (HttpContext context, AccessTokenStore tokens) =>
{
	var authorization = context.Request.Headers.Authorization.ToString();
	if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
		tokens.Revoke(authorization["Bearer ".Length..].Trim());
	return Results.NoContent();
})
	.WithName("Logout")
	.WithSummary("Encerra a sessão atual");
app.MapGet("/api/users", async (UserService service, CancellationToken token) => Results.Ok(await service.GetUsersAsync(token)))
	.WithName("GetUsers")
	.WithSummary("Lista os usuários cadastrados")
	.WithDescription("Disponível somente para gerentes.");
app.MapGet("/api/users/{id:long}", async (long id, UserService service, CancellationToken token) =>
{
	var user = await service.GetByIdAsync(id, token);
	return user is null ? Results.NotFound() : Results.Ok(user);
})
	.WithName("GetUserById")
	.WithSummary("Consulta um usuário pelo ID")
	.WithDescription("Disponível somente para gerentes.");
app.MapPost("/api/users", async (CreateUserRequest request, UserService service, CancellationToken token) =>
{
	try
	{
		var user = await service.CreateAsync(request, token);
		return Results.Created($"/api/users/{user.Id}", user);
	}
	catch (InvalidOperationException exception)
	{
		return Results.Conflict(new { error = exception.Message });
	}
})
	.WithName("CreateUser")
	.WithSummary("Cadastra um usuário")
	.WithDescription("Disponível somente para gerentes. A senha é armazenada como hash PBKDF2.");
app.MapPut("/api/users/{id:long}", async (long id, UpdateUserRequest request, UserService service, AccessTokenStore tokens, CancellationToken token) =>
{
	try
	{
		var user = await service.UpdateAsync(id, request, token);
		tokens.RevokeUser(id);
		return Results.Ok(user);
	}
	catch (InvalidOperationException exception)
	{
		return Results.Conflict(new { error = exception.Message });
	}
})
	.WithName("UpdateUser")
	.WithSummary("Atualiza um usuário")
	.WithDescription("Disponível somente para gerentes. Deixe a senha vazia para mantê-la.");
app.MapDelete("/api/users/{id:long}", async (long id, HttpContext context, UserService service, AccessTokenStore tokens, CancellationToken token) =>
{
	if (!context.Items.TryGetValue("authenticated-user", out var value) || value is not UserResponse currentUser)
		return Results.Unauthorized();
	try
	{
		await service.DeleteAsync(id, currentUser.Id, token);
		tokens.RevokeUser(id);
		return Results.NoContent();
	}
	catch (InvalidOperationException exception)
	{
		return Results.Conflict(new { error = exception.Message });
	}
})
	.WithName("DeleteUser")
	.WithSummary("Exclui um usuário")
	.WithDescription("Disponível somente para gerentes. Não permite excluir a própria conta ou o último gerente.");
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
app.MapPost("/api/products/{id:guid}/movements", async (Guid id, CreateMovementRequest request, HttpContext context, StockService service, CancellationToken token) =>
{
	if (!context.Items.TryGetValue("authenticated-user", out var value) || value is not UserResponse currentUser)
		return Results.Unauthorized();
	var authenticatedRequest = request with { OperatorName = currentUser.Name };
	return Results.Created("/api/movements", await service.CreateMovementAsync(id, authenticatedRequest, token));
});

app.Run();