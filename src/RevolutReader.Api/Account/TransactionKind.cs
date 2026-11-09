using System.Text.Json.Serialization;

namespace RevolutReader.Api.Account;

/// <summary>
/// A transaction's kind (c010 design.md D4), written in the answer as card, topup, transfer, atm, exchange, refund or
/// other (the design system's TxKind), each through JsonStringEnumMemberName, as C13's BankProblemType, so the API
/// description lists exactly these seven values.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<TransactionKind>))]
public enum TransactionKind {
  /// <summary>A card payment: <c>CARD_PAYMENT</c>.</summary>
  [JsonStringEnumMemberName("card")]
  CardPayment,

  /// <summary>A top-up: <c>TOPUP</c>.</summary>
  [JsonStringEnumMemberName("topup")]
  TopUp,

  /// <summary>A transfer: <c>TRANSFER</c>.</summary>
  [JsonStringEnumMemberName("transfer")]
  Transfer,

  /// <summary>A cash withdrawal: <c>ATM</c>.</summary>
  [JsonStringEnumMemberName("atm")]
  CashWithdrawal,

  /// <summary>An exchange: <c>EXCHANGE</c>.</summary>
  [JsonStringEnumMemberName("exchange")]
  Exchange,

  /// <summary>A refund: any code containing <c>REFUND</c>, in any letter case (D4c).</summary>
  [JsonStringEnumMemberName("refund")]
  Refund,

  /// <summary>Any other code, a missing one too.</summary>
  [JsonStringEnumMemberName("other")]
  Other,
}