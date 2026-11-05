using RevolutReader.ServiceDefaults;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

WebApplication app = builder.Build();

app.Run();