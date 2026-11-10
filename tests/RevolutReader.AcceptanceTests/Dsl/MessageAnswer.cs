namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What the owner's message endpoint answered a message sent with the message key (spec push-sending, c011 design.md D3,
/// D10), compared by value, so a scenario states the whole expected answer: the three counts of devices, or a refusal's
/// problem description with the request part it names, never both. The driver (<see cref="Drivers.PushDriver"/>) gives a
/// value only when the answer's exact shape fits one, a problem's status included (its own table of the status each case
/// belongs to), so status codes never reach a scenario.
/// </summary>
/// <param name="Delivered">The devices the message reached; <see langword="null"/> for a refusal.</param>
/// <param name="Failed">The devices whose push service failed, kept; <see langword="null"/> for a refusal.</param>
/// <param name="Removed">The devices their push service reported gone, deleted; <see langword="null"/> for a refusal.</param>
/// <param name="Problem">The refusal's problem description; <see langword="null"/> for counts.</param>
/// <param name="RefusedMember">The part of the message the refusal names; <see langword="null"/> for counts, or for a refusal that names none.</param>
public sealed record MessageAnswer(int? Delivered, int? Failed, int? Removed, ProblemDescription? Problem, RequestPart? RefusedMember) {
  /// <summary>Sent: these counts of devices reached, failed and removed.</summary>
  public static MessageAnswer Counts(int delivered, int failed, int removed) => new(delivered, failed, removed, Problem: null, RefusedMember: null);

  /// <summary>Refused with this problem description, naming this part of the message (<see langword="null"/>: none).</summary>
  public static MessageAnswer Refused(ProblemDescription problem, RequestPart? naming = null) =>
    new(Delivered: null, Failed: null, Removed: null, problem, naming);
}