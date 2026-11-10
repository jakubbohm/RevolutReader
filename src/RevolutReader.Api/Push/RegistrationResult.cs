namespace RevolutReader.Api.Push;

/// <summary>A registration's result (c011 design.md D9, § Error model): the device saved, or the members refused.</summary>
public union RegistrationResult(Registered, SubscriptionRefused);

/// <summary>The device is saved under the signed-in account.</summary>
public sealed record Registered;

/// <summary>The subscription is refused, nothing stored: each refused member with its fixed reason, never its value.</summary>
public sealed record SubscriptionRefused(IReadOnlyList<RefusedMember> Members);