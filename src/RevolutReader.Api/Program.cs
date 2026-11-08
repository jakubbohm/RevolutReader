using FastEndpoints;
using FastEndpoints.OpenApi;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Pages;
using RevolutReader.Api.SignIn;
using RevolutReader.ServiceDefaults;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.Services.AddProblemDetails();
builder.Services.AddFastEndpoints();
// The OpenAPI document, written to openapi.json by an explicit export check (c007 design.md D9). No MapOpenApi(): the app
// never serves it. No JWT bearer scheme: the app signs in with a cookie (ADR-0003).
builder.Services.OpenApiDocument(static options => options.EnableJWTBearerAuth = false);
builder.Services.AddEnableBanking();
builder.Services.AddSignIn();

WebApplication app = builder.Build();

// Every body-less error response (400–599) gets a problem description (RFC 9457), c001 design.md D4.
app.UseStatusCodePages();
app.UseAppPages();
app.UseSignIn();
app.UseFastEndpoints();

app.Run();