using RevolutReader.Api.Push;

namespace RevolutReader.Api.Check;

/// <summary>The notification for a change (c014 design.md D2, D14), pure.</summary>
public static class ChangeNotification {
  /// <summary>
  /// Title "Odešlo …"/"Přišlo …" (the size of last seen − last notified), text "Zůstatek … (≈ … Kč)" of last seen, page "/".
  /// Throws <see cref="ArgumentException"/> when the two do not differ (a caller's bug).
  /// </summary>
  public static PushMessage For(CheckedBalances balances) => throw new NotImplementedException();
}