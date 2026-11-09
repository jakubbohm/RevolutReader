namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What the API answered a device's registration for pushes (spec push-devices, c011 design.md D9), compared by value:
/// registered, or a refusal's problem description with the request part it names. The driver
/// (<see cref="Drivers.PushDriver"/>) gives a value only when the answer's exact shape fits one (a success without
/// content for <see cref="Registered"/>; a problem as it describes), so status codes never reach a scenario.
/// </summary>
/// <param name="Problem">The refusal's problem description; <see langword="null"/> when registered.</param>
/// <param name="RefusedMember">The part of the subscription the refusal names; <see langword="null"/> when registered.</param>
public sealed record RegistrationAnswer(ProblemDescription? Problem, RequestPart? RefusedMember) {
  /// <summary>The device is registered under the signed-in account.</summary>
  public static RegistrationAnswer Registered { get; } = new(Problem: null, RefusedMember: null);

  /// <summary>Refused with this problem description, naming this part of the subscription.</summary>
  public static RegistrationAnswer Refused(ProblemDescription problem, RequestPart naming) => new(problem, naming);
}