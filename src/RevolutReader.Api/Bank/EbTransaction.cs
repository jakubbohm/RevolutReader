namespace RevolutReader.Api.Bank;

/// <summary>
/// One transaction as Enable Banking lists it (API reference <c>Transaction</c>; Mock ASPSP capture
/// <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-transactions.json</c>), with only what the mapping reads
/// (c004 design.md D3). The dates are calendar dates, <c>yyyy-MM-dd</c> on the wire; the amount stays the bank's string.
/// </summary>
/// <param name="EntryReference">The bank's reference; may be missing while pending.</param>
/// <param name="Status"><c>BOOK</c>, <c>PDNG</c>, <c>CNCL</c>, <c>RJCT</c>, <c>HOLD</c>, <c>SCHD</c> or <c>OTHR</c>.</param>
/// <param name="TransactionAmount">Unsigned; <paramref name="CreditDebitIndicator"/> gives the direction.</param>
/// <param name="CreditDebitIndicator"><c>DBIT</c> (money out) or <c>CRDT</c> (money in).</param>
/// <param name="Creditor">Who received the money.</param>
/// <param name="Debtor">Who paid it.</param>
/// <param name="TransactionDate">When the transaction happened, if the bank says.</param>
/// <param name="BookingDate">When the bank booked it.</param>
/// <param name="ValueDate">When it took effect on the balance.</param>
/// <param name="RemittanceInformation">The payment details, line by line; may be empty or missing.</param>
public sealed record EbTransaction(
  string? EntryReference,
  string Status,
  EbAmount TransactionAmount,
  string CreditDebitIndicator,
  EbParty? Creditor,
  EbParty? Debtor,
  DateOnly? TransactionDate,
  DateOnly? BookingDate,
  DateOnly? ValueDate,
  IReadOnlyList<string>? RemittanceInformation);

/// <summary>A creditor or debtor (API reference <c>PartyIdentification</c>), with only its name.</summary>
public sealed record EbParty(string? Name);