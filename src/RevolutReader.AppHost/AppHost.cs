IDistributedApplicationBuilder builder = DistributedApplication.CreateBuilder(args);

IResourceBuilder<ProjectResource> api = builder.AddProject<Projects.RevolutReader_Api>("api")
  .WithHttpHealthCheck("/health");

// The frontend's Vite dev server: locally the app opens at its address, and it forwards /api to the API (c003 design.md D11).
builder.AddViteApp("web", "../RevolutReader.Web")
  .WithReference(api)
  .WaitFor(api);

builder.Build().Run();