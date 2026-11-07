namespace RevolutReader.Api.Bank;

/// <summary>The two statuses a returned transaction can have; every other status is left out (c004 design.md D3).</summary>
public enum TransactionStatus {
  Booked,
  Pending,
}