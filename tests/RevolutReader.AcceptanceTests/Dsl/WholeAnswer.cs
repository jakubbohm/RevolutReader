namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// An answer as a whole, for telling whether two answers are the same (spec push-sending, c011 design.md D10: without
/// the right key, the message endpoint answers exactly as an unknown <c>/api</c> address does). Compared by value, so two
/// answers are equal exactly when a caller cannot tell them apart by what D10 compares: the status, the content type and
/// the body, apart from the trace id, which differs for every request.
/// </summary>
/// <param name="Problem">
/// The problem description the answer is, read as <see cref="Drivers.ApiDriver"/> reads one (status, content type, and
/// the title of that status's case); <see langword="null"/> when it is none.
/// </param>
/// <param name="Text">
/// The answer as text, as the driver (<see cref="Drivers.PushDriver"/>) writes it: the status, the content type, and the
/// body with its <c>traceId</c> left out.
/// </param>
public sealed record WholeAnswer(ProblemDescription? Problem, string Text);