namespace RevolutReader.Api.Storage;

/// <summary>The transaction store's registration (c010 design.md D11).</summary>
public static class StorageRegistration {
  /// <summary>
  /// Throws at registration when ConnectionStrings:tables is not set (the message names the setting, never a value);
  /// AddAzureTableServiceClient("tables") with health checks off; options; TableTransactionStore as the store.
  /// </summary>
  public static IHostApplicationBuilder AddTransactionStore(this IHostApplicationBuilder builder) => throw new NotImplementedException();
}