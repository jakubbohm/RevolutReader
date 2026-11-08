using System.Text.Json.Serialization;

namespace RevolutReader.Api.Account;

/// <summary>
/// A transaction's kind (c010 design.md D4), written in the answer as card, topup, transfer, atm, exchange, refund or
/// other (the design system's TxKind), each through JsonStringEnumMemberName, as C13's BankProblemType.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<TransactionKind>))]
public enum TransactionKind {
  CardPayment,
  TopUp,
  Transfer,
  CashWithdrawal,
  Exchange,
  Refund,
  Other,
}