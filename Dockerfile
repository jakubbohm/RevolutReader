# The app's one image: the frontend built with Node, the backend published with the .NET SDK, both
# on the small "chiseled" ASP.NET Core runtime (ADR-0002-frontend-hosting, c005 design.md D12).
# Build from the repository root: `docker build -t revolutreader:local .`. The build context is an
# allowlist (.dockerignore).
#
# The tags are exact. The SDK tag must hold the SDK that global.json pins (rollForward: disable):
# the move to .NET 11 GA changes global.json and both .NET tags here together.

# 1. The frontend: the major Node version that src/RevolutReader.Web/.node-version pins.
FROM node:24-slim AS web
WORKDIR /src/src/RevolutReader.Web
# The lock file first, so the install is cached until the dependencies change.
COPY src/RevolutReader.Web/package.json src/RevolutReader.Web/package-lock.json src/RevolutReader.Web/.npmrc ./
RUN npm ci
COPY src/RevolutReader.Web/ ./
RUN npm run build

# 2. The backend, published in Release.
FROM mcr.microsoft.com/dotnet/sdk:11.0.100-rc.3-resolute AS build
WORKDIR /src
COPY global.json nuget.config Directory.Build.props Directory.Packages.props BannedSymbols.txt .editorconfig ./
# The project files first, so the restore is cached until a package changes.
COPY src/RevolutReader.ServiceDefaults/RevolutReader.ServiceDefaults.csproj src/RevolutReader.ServiceDefaults/
COPY src/RevolutReader.Api/RevolutReader.Api.csproj src/RevolutReader.Api/
RUN dotnet restore src/RevolutReader.Api/RevolutReader.Api.csproj
COPY src/RevolutReader.ServiceDefaults/ src/RevolutReader.ServiceDefaults/
COPY src/RevolutReader.Api/ src/RevolutReader.Api/
# No native app launcher: the image starts the app with `dotnet`. Analyzers off: build-and-test
# enforces them on every PR, so here they would only make the build longer.
RUN dotnet publish src/RevolutReader.Api/RevolutReader.Api.csproj \
      --configuration Release \
      --output /app \
      -p:UseAppHost=false \
      -p:RunAnalyzers=false

# 3. The image that runs: non-root (user 1654), port 8080, no shell. The frontend's build is the
# web root, which the backend serves (spec app-delivery).
FROM mcr.microsoft.com/dotnet/aspnet:11.0.0-rc.3-resolute-chiseled
# Links the package on ghcr.io to the repository.
LABEL org.opencontainers.image.source="https://github.com/jakubbohm/RevolutReader"
WORKDIR /app
COPY --from=build /app ./
COPY --from=web /src/src/RevolutReader.Web/dist ./wwwroot
EXPOSE 8080
ENTRYPOINT ["dotnet", "RevolutReader.Api.dll"]
