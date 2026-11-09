using System.ComponentModel;

namespace RevolutReader.Api.Account;

/// <summary>
/// The balance as <c>GET /api/balance</c> answers it (spec account-balance, c009 design.md D1): exactly the amount in
/// euros, when the server read it, and the koruna rate the app converts with; nothing else of the bank's answer. The
/// descriptions are the API description's, in plain words.
/// </summary>
[Description("The account's balance in euros, when the server read it, and the koruna rate")]
public sealed record BalanceResponse(
  [property: Description("The account's available balance in euros, as the bank gives it")] decimal Amount,
  [property: Description("When the server read the balance at the bank")] DateTimeOffset ReadAt,
  [property: Description("Czech koruna per euro, the rate the app converts the balance with")] decimal CzkPerEur);