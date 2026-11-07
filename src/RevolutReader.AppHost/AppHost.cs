IDistributedApplicationBuilder builder = DistributedApplication.CreateBuilder(args);

// The bank adapter's four secrets (c004 design.md D6): this AppHost's user-secrets locally (Parameters:enablebanking-*),
// handed to the API as the environment variables that override appsettings.json's "<secret>" placeholders.
IResourceBuilder<ParameterResource> applicationId = builder.AddParameter("enablebanking-application-id", secret: true);
IResourceBuilder<ParameterResource> privateKey = builder.AddParameter("enablebanking-private-key", secret: true);
IResourceBuilder<ParameterResource> sessionId = builder.AddParameter("enablebanking-session-id", secret: true);
IResourceBuilder<ParameterResource> accountId = builder.AddParameter("enablebanking-account-id", secret: true);

IResourceBuilder<ProjectResource> api = builder.AddProject<Projects.RevolutReader_Api>("api")
  .WithHttpHealthCheck("/health")
  .WithEnvironment("EnableBanking__ApplicationId", applicationId)
  .WithEnvironment("EnableBanking__PrivateKey", privateKey)
  .WithEnvironment("EnableBanking__SessionId", sessionId)
  .WithEnvironment("EnableBanking__AccountId", accountId);

// The frontend's Vite dev server: locally the app opens at its address, and it forwards /api to the API (c003 design.md D11).
builder.AddViteApp("web", "../RevolutReader.Web")
  .WithReference(api)
  .WaitFor(api);

builder.Build().Run();