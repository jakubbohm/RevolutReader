using FastEndpoints;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Pages;
using RevolutReader.ServiceDefaults;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.Services.AddProblemDetails();
builder.Services.AddFastEndpoints();
builder.Services.AddEnableBanking();

WebApplication app = builder.Build();

// Every body-less error response (400–599) gets a problem description (RFC 9457), c001 design.md D4.
app.UseStatusCodePages();
app.UseAppPages();
app.UseFastEndpoints();

app.Run();