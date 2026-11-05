IDistributedApplicationBuilder builder = DistributedApplication.CreateBuilder(args);

builder.AddProject<Projects.RevolutReader_Api>("api")
  .WithHttpHealthCheck("/health");

builder.Build().Run();