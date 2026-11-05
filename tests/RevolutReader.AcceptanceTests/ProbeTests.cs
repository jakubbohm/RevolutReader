using Shouldly;

namespace RevolutReader.AcceptanceTests;

/// <summary>Fails on purpose: the merge-gate probe of c002 design.md D6. Never merged.</summary>
public sealed class ProbeTests {
  [Test]
  public void Probe_fails_on_purpose() {
    int answer = 1;
    answer.ShouldBe(2);
  }
}
