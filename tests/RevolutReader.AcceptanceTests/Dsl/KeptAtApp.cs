namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A settled transaction the app already keeps (spec account-transactions, GIVEN), written into the test app copy's own
/// table by the driver (<see cref="Drivers.TransactionsDriver.Keep"/>), which gives each a unique made-up reference and
/// its place within its day in the order given. Whatever a scenario does not give is absent: no counterparty, no
/// details, no type code.
/// </summary>
/// <param name="Date">The day it is dated by, the scenario's (<see cref="Drivers.ScenarioCalendar"/>).</param>
/// <param name="Amount">Negative for money spent, positive for money received.</param>
/// <param name="Counterparty">The payee of money spent, the payer of money received.</param>
public sealed record KeptAtApp(DateOnly Date, decimal Amount, string? Counterparty = null);