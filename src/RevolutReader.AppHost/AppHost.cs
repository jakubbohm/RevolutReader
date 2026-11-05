IDistributedApplicationBuilder builder = DistributedApplication.CreateBuilder(args);

builder.AddProject<Projects.RevolutReader_Api>("api");

builder.Build().Run();