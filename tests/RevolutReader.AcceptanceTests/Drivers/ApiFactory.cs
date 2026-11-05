using TUnit.AspNetCore;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>The session-wide factory (c001 design.md D6). Each test runs on its own app copy derived from it (<see cref="AcceptanceTest"/>).</summary>
public sealed class ApiFactory : TestWebApplicationFactory<Program>;