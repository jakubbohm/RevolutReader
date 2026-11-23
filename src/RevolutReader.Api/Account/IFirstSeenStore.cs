namespace RevolutReader.Api.Account;

/// <summary>The kept first-seen moments, by the bank's reference (c018 design.md D3, § Ports and contracts).</summary>
public interface IFirstSeenStore {
  /// <summary>The kept moment of each of <paramref name="references"/> that has one; the others absent. Nothing asked: no request.</summary>
  Task<IReadOnlyDictionary<string, DateTimeOffset>> Read(IReadOnlyCollection<string> references, CancellationToken cancellationToken);

  /// <summary>
  /// For each sighting, the earliest moment ever recorded for its reference is kept: recorded when none is, replacing a
  /// later one, never an earlier one; the same in any order and from any number of callers at once. Answers the moment
  /// kept for each sighting's reference after the call. Nothing to record: no request.
  /// </summary>
  Task<IReadOnlyDictionary<string, DateTimeOffset>> Record(IReadOnlyList<FirstSeen> sightings, CancellationToken cancellationToken);
}