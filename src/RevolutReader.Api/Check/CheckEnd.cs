namespace RevolutReader.Api.Check;

/// <summary>What a check came to, as its <c>CheckEnded</c> line names it (c014 design.md D15).</summary>
public enum CheckEnd {
  /// <summary>The first successful read: kept as both balances, nothing sent.</summary>
  FirstBalanceKept,

  /// <summary>Last seen equals last notified: nothing sent.</summary>
  Unchanged,

  /// <summary>A change, left to the check waiting behind this one.</summary>
  ChangeLeftToTheNextCheck,

  /// <summary>A change, sent to every allowed account.</summary>
  ChangeNotified,

  /// <summary>The bank read failed.</summary>
  BankReadFailed,
}