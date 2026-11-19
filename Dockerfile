FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore backend/src/Estoque.Api/Estoque.Api.csproj
RUN dotnet publish backend/src/Estoque.Api/Estoque.Api.csproj --configuration Release --no-restore --output /out

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app/backend/src/Estoque.Api
COPY --from=build /out/ ./
COPY --from=build /src/frontend/wwwroot/ /app/frontend/wwwroot/

ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec dotnet Estoque.Api.dll --urls http://0.0.0.0:${PORT:-8080}"]
