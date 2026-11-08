using Aspire.Hosting.Azure;

IDistributedApplicationBuilder builder = DistributedApplication.CreateBuilder(args);

// The bank adapter's four secrets (c004 design.md D6): this AppHost's user-secrets locally (Parameters:enablebanking-*),
// handed to the API as the environment variables that override appsettings.json's "<secret>" placeholders.
IResourceBuilder<ParameterResource> applicationId = builder.AddParameter("enablebanking-application-id", secret: true);
IResourceBuilder<ParameterResource> privateKey = builder.AddParameter("enablebanking-private-key", secret: true);
IResourceBuilder<ParameterResource> sessionId = builder.AddParameter("enablebanking-session-id", secret: true);
IResourceBuilder<ParameterResource> accountId = builder.AddParameter("enablebanking-account-id", secret: true);

// The sign-in's two secrets (c007 design.md D11), in the same way (Parameters:signin-*): the Entra registration's client
// secret and the allowlist, comma-separated addresses.
IResourceBuilder<ParameterResource> signInClientSecret = builder.AddParameter("signin-client-secret", secret: true);
IResourceBuilder<ParameterResource> signInAllowedEmails = builder.AddParameter("signin-allowed-emails", secret: true);

// The transaction store's tables (c010 design.md D11): Azurite in Docker, handed to the API as ConnectionStrings__tables.
IResourceBuilder<AzureTableStorageResource> tables = builder.AddAzureStorage("storage")
  .RunAsEmulator()
  .AddTables("tables");

IResourceBuilder<ProjectResource> api = builder.AddProject<Projects.RevolutReader_Api>("api")
  .WithHttpHealthCheck("/health")
  .WithReference(tables)
  .WaitFor(tables)
  .WithEnvironment("EnableBanking__ApplicationId", applicationId)
  .WithEnvironment("EnableBanking__PrivateKey", privateKey)
  .WithEnvironment("EnableBanking__SessionId", sessionId)
  .WithEnvironment("EnableBanking__AccountId", accountId)
  .WithEnvironment("SignIn__ClientSecret", signInClientSecret)
  .WithEnvironment("SignIn__AllowedEmails", signInAllowedEmails);

// The frontend's Vite dev server: locally the app opens at its address, and it forwards /api to the API (c003 design.md D11).
// Over HTTPS with the ASP.NET Core development certificate (c007 design.md D2): the sign-in's temporary cookies need
// Secure, and Microsoft returns to https://localhost/api/auth/signin-oidc. Aspire 13.6's AddViteApp leaves HTTPS off
// unless asked; asked, it hands Vite the certificate through a wrapper config of its own.
#pragma warning disable ASPIRECERTIFICATES001 // WithHttpsDeveloperCertificate is experimental in Aspire 13.6, and the only way to serve the Vite app over HTTPS here (c007 design.md D2).
builder.AddViteApp("web", "../RevolutReader.Web")
  .WithHttpsDeveloperCertificate()
  .WithReference(api)
  .WaitFor(api);
#pragma warning restore ASPIRECERTIFICATES001

builder.Build().Run();