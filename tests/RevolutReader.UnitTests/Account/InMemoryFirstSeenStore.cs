using RevolutReader.Api.Account;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The first-seen moments in memory (c018 design.md D3, § Ports and contracts): the in-memory fake of
/// <see cref="IFirstSeenStore"/> the unit tests use. The integration project compiles this same file into its contract
/// tests, which run it and the Table adapter against the same tests, so it stays self-contained: it needs nothing from
/// either test project.
/// <list type="bullet">
/// <item><see cref="Read"/>: the kept moment of each reference asked for that has one, exactly as recorded; the others
/// absent.</item>
/// <item><see cref="Record"/>: for each sighting, the earliest moment for its reference is kept: recorded when none is,
/// replacing a later one, never an earlier one, so the order of the calls changes nothing. Answers the moment kept for each
/// sighting's reference after the call.</item>
/// <item>The requests it would send, counted (<see cref="ReadRequests"/>, <see cref="RecordRequests"/>): a call with
/// something to read or record. A call with nothing in it is no request, as the adapter sends none for it (§ Ports and
/// contracts: "Nothing asked or nothing to record: no request").</item>
/// <item>It can be made to fail (<see cref="FailWith"/>): every call from then on throws the given exception, as a store
/// failure is an exception (design.md D8, § Error model).</item>
/// <item>Safe for calls from several threads at once (two readers record at once).</item>
/// </list>
/// </summary>
public sealed class InMemoryFirstSeenStore : IFirstSeenStore {
  private readonly Lock _lock = new();
  private readonly Dictionary<string, DateTimeOffset> _kept = new(StringComparer.Ordinal);
  private int _readRequests;
  private int _recordRequests;
  private Exception? _failure;

  /// <summary>How many reads asked for at least one reference so far.</summary>
  public int ReadRequests {
    get {
      lock (_lock)
        return _readRequests;
    }
  }

  /// <summary>How many records had at least one sighting so far.</summary>
  public int RecordRequests {
    get {
      lock (_lock)
        return _recordRequests;
    }
  }

  /// <summary>Every call from now on throws <paramref name="failure"/>, and changes nothing.</summary>
  public void FailWith(Exception failure) {
    ArgumentNullException.ThrowIfNull(failure);

    lock (_lock)
      _failure = failure;
  }

  public Task<IReadOnlyDictionary<string, DateTimeOffset>> Read(IReadOnlyCollection<string> references, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(references);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock) {
      ThrowIfFailing();

      if (references.Count > 0)
        _readRequests++;

      Dictionary<string, DateTimeOffset> answer = new(StringComparer.Ordinal);

      foreach (string reference in references) {
        if (_kept.TryGetValue(reference, out DateTimeOffset at))
          answer[reference] = at;
      }

      return Task.FromResult<IReadOnlyDictionary<string, DateTimeOffset>>(answer);
    }
  }

  public Task<IReadOnlyDictionary<string, DateTimeOffset>> Record(IReadOnlyList<FirstSeen> sightings, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(sightings);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock) {
      ThrowIfFailing();

      if (sightings.Count > 0)
        _recordRequests++;

      foreach (FirstSeen sighting in sightings) {
        if (!_kept.TryGetValue(sighting.Reference, out DateTimeOffset kept) || sighting.At < kept)
          _kept[sighting.Reference] = sighting.At;
      }

      Dictionary<string, DateTimeOffset> answer = new(StringComparer.Ordinal);

      foreach (FirstSeen sighting in sightings)
        answer[sighting.Reference] = _kept[sighting.Reference];

      return Task.FromResult<IReadOnlyDictionary<string, DateTimeOffset>>(answer);
    }
  }

  /// <summary>Throws the failure <see cref="FailWith"/> set, if any; called under the lock.</summary>
  private void ThrowIfFailing() {
    if (_failure is not null)
      throw _failure;
  }
}