using RevolutReader.Api.Account;
using RevolutReader.Api.Push;

namespace RevolutReader.Api.Check;

/// <summary>
/// The notification for a change (c014 design.md D2, D14), pure. The spacing is the board's: the amounts' no-break spaces
/// come from <see cref="CzechAmounts"/>, a no-break space follows "≈", and ordinary spaces follow "Odešlo" and "Zůstatek"
/// and precede "(".
/// </summary>
public static class ChangeNotification {
  /// <summary>The title of a fall, before the size of the change (D2).</summary>
  private const string MONEY_OUT = "Odešlo ";

  /// <summary>The text's start, before the new balance (D2).</summary>
  private const string BALANCE = "Zůstatek ";

  /// <summary>Before the koruna value: an ordinary space, the bracket, "≈" and a no-break space (D2).</summary>
  private const string ABOUT = " (≈ ";

  private const string CLOSING_BRACKET = ")";

  /// <summary>The page a tap opens: the account screen, as the owner's messages open by default (D2).</summary>
  private const string START_PAGE = "/";

  /// <summary>
  /// Title "Odešlo …"/"Přišlo …" (the size of last seen − last notified), text "Zůstatek … (≈ … Kč)" of last seen, page "/".
  /// Throws <see cref="ArgumentException"/> when the two do not differ (a caller's bug).
  /// </summary>
  public static PushMessage For(CheckedBalances balances) {
    ArgumentNullException.ThrowIfNull(balances);

    if (!balances.Changed)
      throw new ArgumentException("The two balances do not differ by a cent or more, so there is no change to notify.", nameof(balances));

    AccountBalance lastSeen = balances.LastSeen;
    decimal change = lastSeen.Amount - balances.LastNotified.Amount;

    if (change > 0)
      throw new NotImplementedException("A rise (\"Přišlo\") comes with c014 tasks.md 18.");

    string title = MONEY_OUT + CzechAmounts.Euros(Math.Abs(change));
    string text = BALANCE + CzechAmounts.Euros(lastSeen.Amount) + ABOUT + CzechAmounts.WholeKoruna(lastSeen.Amount, lastSeen.CzkPerEur) + CLOSING_BRACKET;

    return new PushMessage(title, text, START_PAGE);
  }
}