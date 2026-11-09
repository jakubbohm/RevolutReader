using FastEndpoints;
using FastEndpoints.OpenApi;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using RevolutReader.Api.DataProtection;
using RevolutReader.Api.Hosting;
using RevolutReader.Api.Pages;
using RevolutReader.Api.Push;
using RevolutReader.Api.SignIn;
using RevolutReader.Api.Storage;
using RevolutReader.ServiceDefaults;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.Services.AddProblemDetails();
builder.Services.AddFastEndpoints();
// The OpenAPI document, written to openapi.json by an explicit export check (c007 design.md D9). No MapOpenApi(): the app
// never serves it. No JWT bearer scheme: the app signs in with a cookie (ADR-0003).
builder.Services.OpenApiDocument(static options => options.EnableJWTBearerAuth = false);
builder.Services.AddEnableBanking();
builder.Services.AddBalance();
// The store checks its connection while registering, so a missing one stops the app at start (c010 design.md D11).
builder.AddTransactionStore();
// On the tables client AddTransactionStore registers (c011 design.md D11).
builder.AddPushDeviceStore();
builder.Services.AddTransactions();
builder.Services.AddPush();
builder.Services.AddSignIn();
// Where the login cookie's keys live is chosen while registering services, so the composition root hands over the
// configuration: the DataProtection section and AZURE_CLIENT_ID (c007 design.md D7).
builder.Services.AddDataProtectionKeys(builder.Configuration);

WebApplication app = builder.Build();

// First: the scheme and the client's address as the hosting proxy received them (c007 design.md D10).
app.UseForwardedHeadersFromIngress();
// Every body-less error response (400–599) gets a problem description (RFC 9457), c001 design.md D4.
app.UseStatusCodePages();
// An unhandled exception answers 500 as a problem description through AddProblemDetails, with no exception text, and is
// logged once (spec api-errors, c009 design.md D1). After UseStatusCodePages, so a caller that rules JSON out gets its
// plain-text status line rather than an empty 500. Not FastEndpoints' UseDefaultExceptionHandler, which logs twice and
// echoes the exception's message in the body.
app.UseExceptionHandler();
app.UseAppPages();
app.MapApiNotFound();
app.UseSignIn();
// A request FastEndpoints cannot bind answers 400 as a problem description too (spec api-errors), not in its own format.
// A calendar date is read as yyyy-MM-dd only, whatever the server's culture (c010 design.md D10).
app.UseFastEndpoints(static config => {
  config.Errors.UseProblemDetails();
  config.Binding.ValueParserFor<DateOnly>(CalendarDateBinding.Parse);
});

app.Run();