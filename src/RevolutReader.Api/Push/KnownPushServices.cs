using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Push;

/// <summary>
/// The known push services (c011 design.md D9): whether a push address may be registered. Whatever address a device
/// registers, the server later sends a request to it, so only addresses at the services <c>Push:Services</c> names are
/// accepted, never one a signed-in user could point anywhere else (e.g. inside Azure's network).
/// </summary>
public sealed class KnownPushServices(IOptions<PushOptions> options) {
  /// <summary>The longest push address accepted (D9).</summary>
  private const int LONGEST_ADDRESS = 2048;

  private readonly IReadOnlyList<PushServicePattern> _services = Patterns(options);

  /// <summary>
  /// Whether <paramref name="pushAddress"/> is an absolute address of at most 2048 characters, with no user information,
  /// at one of the known services (<see cref="PushServicePattern.Matches"/>): plain http only at a loopback service the
  /// settings name.
  /// </summary>
  public bool Accepts(string pushAddress) {
    ArgumentNullException.ThrowIfNull(pushAddress);

    return pushAddress.Length <= LONGEST_ADDRESS
      && Uri.TryCreate(pushAddress, UriKind.Absolute, out Uri? address)
      && address.UserInfo.Length == 0
      && _services.Any(service => service.Matches(address));
  }

  /// <summary>
  /// Every known service's pattern. A pattern that does not parse is a configuration the start-up check must refuse, so it
  /// stops here too, naming the entry, never its value, rather than match nothing unnoticed.
  /// </summary>
  private static PushServicePattern[] Patterns(IOptions<PushOptions> options) {
    ArgumentNullException.ThrowIfNull(options);

    return [.. options.Value.Services.Select(static entry => PushServicePattern.TryParse(entry.Value, out PushServicePattern? pattern)
      ? pattern
      : throw new InvalidOperationException($"The known push service \"{entry.Key}\" (Push:Services) is not a push service pattern."))];
  }
}