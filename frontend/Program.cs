var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = "frontend/wwwroot"
});
var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.Run();