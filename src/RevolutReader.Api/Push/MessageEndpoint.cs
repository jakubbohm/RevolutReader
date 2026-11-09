using System.Diagnostics;
using System.Text.Json;
using FastEndpoints;
using FluentValidation.Results;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Push;

/// <summary>
/// <c>POST /api/push/messages</c> (spec push-sending, c011 design.md D10): the owner's message to an account's devices,
/// for anyone holding the message key. Anonymous, on the checked list of anonymous endpoints, and kept out of the API
/// description; it binds nothing, so nothing is read before the key is checked.
/// <list type="bullet">
/// <item>The key first (<see cref="MessageKeyCheck"/> on <see cref="MessageKeyCheck.HEADER"/>): a missing, repeated or
/// wrong key answers a 404 with no body, which <c>UseStatusCodePages</c> fills in exactly as for an unknown <c>/api</c>
/// address, whatever the body holds.</item>
/// <item>Then the JSON body, read here: a body that is not the request's JSON (<see cref="MessageRequest"/>), a missing
/// account or a missing title answers 400, FastEndpoints' validation problem naming <c>body</c>, <c>account</c> or
/// <c>title</c> with a fixed reason, never a value.</item>
/// <item>Then <see cref="SendPushHandler"/>, the page <c>/</c> when none is given: <see cref="PushSent"/> answers 200
/// <see cref="MessageOutcomeResponse"/>, the three counts; <see cref="AccountNotAllowed"/> a 404 problem of its own,
/// <c>/problems/push-account-not-allowed</c>, titled <c>Account not allowed</c>.</item>
/// </list>
/// A write from PowerShell carries neither <c>Sec-Fetch-Site</c> nor <c>Origin</c>, so the cross-site rule lets it through.
/// </summary>
public sealed class MessageEndpoint(SendPushHandler sender, IOptions<PushOptions> options) : EndpointWithoutRequest {
  /// <summary>The members a refusal names (D10).</summary>
  private const string BODY = "body";
  private const string ACCOUNT = "account";
  private const string TITLE = "title";

  private const string NOT_THE_MESSAGE = "The body is not the message's JSON.";
  private const string MISSING = "Missing.";

  /// <summary>The page a tap opens when the message names none (D2): the account screen.</summary>
  private const string START_PAGE = "/";

  /// <summary>The problem of an account not on the allowlist (D10).</summary>
  private const string ACCOUNT_NOT_ALLOWED_TYPE = "/problems/push-account-not-allowed";
  private const string ACCOUNT_NOT_ALLOWED_TITLE = "Account not allowed";

  public override void Configure() {
    Post("/api/push/messages");
    AllowAnonymous();
    Description(static endpoint => endpoint.ExcludeFromDescription());
  }

  public override async Task HandleAsync(CancellationToken ct) {
    if (!MessageKeyCheck.Matches(HttpContext.Request.Headers[MessageKeyCheck.HEADER], options.Value.MessageKey)) {
      await Send.ResultAsync(TypedResults.NotFound());

      return;
    }

    MessageRequest? request = await ReadMessage(ct);
    List<ValidationFailure> refused = Refusals(request);

    if (refused.Count > 0) {
      foreach (ValidationFailure failure in refused)
        AddError(failure);

      await Send.ErrorsAsync(cancellation: ct);

      return;
    }

    if (request is not { Account: { } account, Title: { } title })
      throw new UnreachableException("A message with no refused member has its account and title.");

#pragma warning disable CA1508 // Its interprocedural analysis follows the sender's returns and calls an arm always true; each case is named, so a case added to the union later is a compile error rather than a silent default.
    IResult answer = await sender.Send(account, new PushMessage(title, request.Text, request.Page ?? START_PAGE), ct) switch {
      PushSent sent => TypedResults.Ok(new MessageOutcomeResponse(sent.Delivered, sent.Failed, sent.Removed)),
      AccountNotAllowed => TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: ACCOUNT_NOT_ALLOWED_TITLE, type: ACCOUNT_NOT_ALLOWED_TYPE),
    };
#pragma warning restore CA1508

    await Send.ResultAsync(answer);
  }

  /// <summary>Each member of <paramref name="request"/> that is refused, with its fixed reason; the body itself when it is none.</summary>
  private static List<ValidationFailure> Refusals(MessageRequest? request) {
    if (request is null)
      return [new ValidationFailure(BODY, NOT_THE_MESSAGE)];

    List<ValidationFailure> refused = [];

    if (string.IsNullOrWhiteSpace(request.Account))
      refused.Add(new ValidationFailure(ACCOUNT, MISSING));

    if (request.Title is null)
      refused.Add(new ValidationFailure(TITLE, MISSING));

    return refused;
  }

  /// <summary>The body as the message's JSON; <see langword="null"/> when it is not JSON, not that shape, or <c>null</c>.</summary>
  private async Task<MessageRequest?> ReadMessage(CancellationToken cancellationToken) {
    if (!HttpContext.Request.HasJsonContentType())
      return null;

    try {
      return await HttpContext.Request.ReadFromJsonAsync<MessageRequest>(cancellationToken);
    }
    catch (JsonException) {
      return null;
    }
  }
}