using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RevolutReader.IntegrationTests.HistoryImport;

/// <summary>
/// Made-up history files of the M1 file's shape (c010 design.md D9), as <c>spikes/enable-banking/export-history.ps1</c>
/// writes it: <c>exported_utc</c>, <c>history_start</c> 2026-08-09, <c>date_from</c> the day before, and one account
/// (<c>account</c> 1) whose pages are raw Enable Banking answers, a continuation key on every page but the last. Each
/// transaction has the fields of the Mock ASPSP capture
/// (<c>spikes/enable-banking-mock/evidence/2026-11-06-account1-transactions.json</c>), <c>null</c> where unused: a
/// booked one with its booking and value date, a pending one with its transaction date, as the capture's. The type code
/// is written from the Enable Banking API reference (<c>BankTransactionCode</c>), since the Mock ASPSP leaves it
/// <c>null</c>. Everything is made up: the names are the specs' made-up ones, the references, amounts and keys invented.
/// The file is UTF-8 without a byte order mark, its letters unescaped, as PowerShell 7 writes it.
/// </summary>
internal static class MadeUpHistory {
  /// <summary>When the made-up file was exported; its day is <see cref="ExportDay"/>.</summary>
  public const string EXPORTED_UTC = "2026-11-04T09:12:44Z";

  /// <summary>The day of <see cref="EXPORTED_UTC"/>, the export's own day.</summary>
  public static readonly DateOnly ExportDay = new(2026, 11, 4);

  private const string DATE = "yyyy-MM-dd";

  private static readonly JsonSerializerOptions _written = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

  /// <summary>A settled card payment of 12.30 EUR at Pekárna U Lípy, one line of details.</summary>
  public static JsonObject Settled(string reference, DateOnly day) => SettledPayment(reference, day, "12.30", "Pekárna U Lípy", "CARD_PAYMENT", "Praha 2");

  /// <summary>A settled payment (<c>BOOK</c>, <c>DBIT</c>): the payee is the creditor.</summary>
  public static JsonObject SettledPayment(string reference, DateOnly day, string amount, string payee, string typeCode, params string[] details) =>
    Transaction(reference, "BOOK", "DBIT", day, amount, creditor: payee, debtor: null, typeCode, details);

  /// <summary>Settled money received (<c>BOOK</c>, <c>CRDT</c>): the payer is the debtor.</summary>
  public static JsonObject SettledReceipt(string reference, DateOnly day, string amount, string payer, string typeCode, params string[] details) =>
    Transaction(reference, "BOOK", "CRDT", day, amount, creditor: null, debtor: payer, typeCode, details);

  /// <summary>A pending card payment of 8.90 EUR at Kavárna Na Rohu (<c>PDNG</c>), with or without a reference.</summary>
  public static JsonObject Pending(string? reference, DateOnly day) =>
    Transaction(reference, "PDNG", "DBIT", day, "8.90", creditor: "Kavárna Na Rohu", debtor: null, "CARD_PAYMENT", ["Kavárna Na Rohu"]);

  /// <summary>The file, exported at <see cref="EXPORTED_UTC"/>, with these pages in this order.</summary>
  public static JsonObject File(params IReadOnlyList<JsonObject>[] pages) {
    JsonArray written = [];

    for (int index = 0; index < pages.Length; index++) {
      written.Add(new JsonObject {
        ["transactions"] = new JsonArray([.. pages[index]]),
        ["continuation_key"] = index < pages.Length - 1 ? $"made-up-continuation-key-{index + 1}" : null,
      });
    }

    return new JsonObject {
      ["exported_utc"] = EXPORTED_UTC,
      ["history_start"] = "2026-08-09",
      ["date_from"] = "2026-08-08",
      ["accounts"] = new JsonArray(new JsonObject { ["account"] = 1, ["pages"] = written }),
    };
  }

  /// <summary>
  /// The file without its <c>history_start</c>, as the first run of the export script wrote the M1 file on 2026-11-04 (its
  /// evidence: <c>spikes/enable-banking/evidence/2026-11-04-history-export.json</c>); <c>date_from</c> stays.
  /// </summary>
  public static JsonObject WithoutHistoryStart(JsonObject file) {
    ArgumentNullException.ThrowIfNull(file);

    file.Remove("history_start");

    return file;
  }

  /// <summary>The page at <paramref name="index"/> (0 first) of the file's one account.</summary>
  public static JsonObject Page(JsonObject file, int index) {
    ArgumentNullException.ThrowIfNull(file);

    return file["accounts"]![0]!["pages"]![index]!.AsObject();
  }

  /// <summary>The file's bytes, as a stream at its start.</summary>
  public static MemoryStream AsStream(JsonObject file) {
    ArgumentNullException.ThrowIfNull(file);

    return new MemoryStream(Encoding.UTF8.GetBytes(file.ToJsonString(_written)));
  }

  /// <summary>A transaction with every field of the capture; <c>null</c> where it has none.</summary>
  private static JsonObject Transaction(string? reference, string status, string indicator, DateOnly day, string amount, string? creditor, string? debtor, string typeCode, string[] details) {
    string date = day.ToString(DATE, CultureInfo.InvariantCulture);
    bool booked = status == "BOOK";

    return new JsonObject {
      ["entry_reference"] = reference,
      ["merchant_category_code"] = null,
      ["transaction_amount"] = new JsonObject { ["currency"] = "EUR", ["amount"] = amount },
      ["creditor"] = Party(creditor),
      ["creditor_account"] = null,
      ["creditor_agent"] = null,
      ["debtor"] = Party(debtor),
      ["debtor_account"] = null,
      ["debtor_agent"] = null,
      ["bank_transaction_code"] = new JsonObject { ["description"] = null, ["code"] = typeCode, ["sub_code"] = null },
      ["credit_debit_indicator"] = indicator,
      ["status"] = status,
      ["booking_date"] = booked ? date : null,
      ["value_date"] = booked ? date : null,
      ["transaction_date"] = booked ? null : date,
      ["balance_after_transaction"] = null,
      ["reference_number"] = null,
      ["reference_number_schema"] = null,
      ["remittance_information"] = new JsonArray([.. details.Select(static line => JsonValue.Create(line))]),
      ["debtor_account_additional_identification"] = null,
      ["creditor_account_additional_identification"] = null,
      ["exchange_rate"] = null,
      ["note"] = null,
      ["transaction_id"] = null,
    };
  }

  /// <summary>A creditor or debtor with this name and nothing else, as the capture writes one; <c>null</c> for none.</summary>
  private static JsonObject? Party(string? name) => name is null ? null : new JsonObject {
    ["name"] = name,
    ["postal_address"] = null,
    ["organisation_id"] = null,
    ["private_id"] = null,
    ["contact_details"] = null,
  };
}