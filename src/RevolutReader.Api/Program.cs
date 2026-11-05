using FastEndpoints;
using RevolutReader.ServiceDefaults;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.Services.AddFastEndpoints();

WebApplication app = builder.Build();

app.UseFastEndpoints();

app.Run();