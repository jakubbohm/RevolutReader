# Tasks: c011-add-push-sending

Before this list: design.md § Bootstrap, committed as `[setup]`:

- the package `Lib.Net.Http.WebPush` 3.3.1 and the vulnerability check;
- the probes (the library against WireMock, its names into the sketch; a `DELETE` body through FastEndpoints and the generated client; the keyless 404 against an unknown address's, and `ExcludeFromDescription`). A probe that contradicts design.md (D9's `DELETE` body, D10's 404) is shown to the owner before `/tdd-apply`.

Its baseline holds one known exception, accepted once: the traceability check reports this change's 18 new scenarios as not claimed, until group 1 claims them.

Run with `/tdd-apply c011-add-push-sending` (roadmap C8a; the owner picks the review mode at the start). There are 18 scenarios, all API acceptance tests (design.md D14), so the work is sliced per scenario: slices 1–13 the sending side, 14–18 the device side. Then the shared frontend pieces (no scenario, D8), deployment, the guided key tasks, the docs and a local check.

- Docs tasks are the orchestrator's; "Guided" tasks need the owner.
- **"Green"** means the full suite: `dotnet test` (Docker running, for Azurite), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check`. Exception: this change's acceptance tests stay red until their slice.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (API), as design.md § Public API sketch and D7:
  - `Drivers/FakePushService` (a WireMock server per test, started before the app copy; its `Configure` writes the `Push` section: a made-up VAPID pair generated once per test run, a made-up message key, a made-up `Subject`, and its own origin as `Push:Services:FakePushService`), `Drivers/TestDevice`, `Drivers/PushDriver`, `Dsl/PushDsl` and its records as signatures whose methods throw `NotImplementedException`; `AcceptanceTest.Push`; `FakePushService.Configure` called next to `FakeBank.Configure` for every app copy;
  - `Drivers/AzuriteStorage.Configure` also sets `PushDevices:TableName` to a table of the app copy's own;
  - `Dsl/Visitor.Petr` (`Petr Novák`, `petr@example.com`, made up), and `FakeMicrosoft.ALLOWED_EMAILS` holds Lucie and Petr;
  - `Dsl/ProblemDescription.PushAccountNotAllowed` (`Account not allowed`, `/problems/push-account-not-allowed`).

  Verify: build passes; every acceptance test that was green stays green (the allowlist steps check the configured list)
- [x] 1.2 Acceptance: push-devices / The app gets the public push key
- [x] 1.3 Acceptance: push-devices / Registering the same device again moves it to the account signed in now
- [x] 1.4 Acceptance: push-devices / A push address outside the known push services is refused
- [x] 1.5 Acceptance: push-devices / A subscription with missing or wrong-sized keys is refused
- [x] 1.6 Acceptance: push-devices / A forgotten device gets no more messages
- [x] 1.7 Acceptance: push-devices / Forgetting a device that was never registered is fine
- [x] 1.8 Acceptance: push-sending / A registered device receives a message sent to its account
- [x] 1.9 Acceptance: push-sending / A message reaches every device of the account and none of another account's
- [x] 1.10 Acceptance: push-sending / Every push lives 24 hours and is urgent
- [x] 1.11 Acceptance: push-sending / An allowed account with no devices gets zero counts
- [x] 1.12 Acceptance: push-sending / A message without the right key gets the answer of an unknown address
- [x] 1.13 Acceptance: push-sending / A message to an account not on the allowlist is refused
- [x] 1.14 Acceptance: push-sending / A message to an account no longer on the allowlist deletes its devices
- [x] 1.15 Acceptance: push-sending / A message without a title is refused
- [x] 1.16 Acceptance: push-sending / A message whose page is not a page of the app is refused
- [x] 1.17 Acceptance: push-sending / A message too long for a push is refused
- [x] 1.18 Acceptance: push-sending / A device the push service reports gone is deleted
- [x] 1.19 Acceptance: push-sending / A device whose push service fails is counted as failed and kept

## 2. [unit] Slice 1 — Push settings

- [x] 2.1 A complete set of push settings passes validation
- [x] 2.2 A push secret still holding the placeholder fails validation, and the message names the setting only
- [x] 2.3 A public key that is not a 65-byte P-256 point in base64url fails validation, naming the setting only
- [x] 2.4 A private key that is not 32 bytes in base64url fails validation, naming the setting only
- [x] 2.5 Two key halves that are not one pair fail validation
- [x] 2.6 A message key shorter than 32 bytes fails validation
- [x] 2.7 A subject that is not an https origin (a path, a query, plain http, a relative address) fails validation
- [x] 2.8 A request timeout outside 1 to 60 seconds fails validation
- [x] 2.9 The known push services declared in appsettings.json pass validation

## 3. [wiring] Slice 1 — Settings, AppHost and the key endpoint

- [x] 3.1 `appsettings.json` gains the `Push` section (design.md D5, D9, D13: the three secrets as `"<secret>"`, `Subject` `https://localhost`, the four known push services, `RequestTimeout` `00:00:10`), each key with its provenance comment; `PushOptions` bound and validated on start in `PushRegistration.AddPush`, called in `Program.cs`. Verify: the app starts in every acceptance test (they get the fake's settings); slice 1's unit tests green
- [x] 3.2 Every other place that starts the app gets made-up push values: the OpenAPI export check (`OpenApiExport`); the CI image smoke run (`.github/workflows/ci.yml`: a pair generated per run with a Node one-liner, a random message key); `CLAUDE.md`'s image quick start, both shells (design.md § Cross-cutting effects). Verify: the export check runs; the smoke run's command run locally against `docker build` answers `/health`
- [x] 3.3 The AppHost's three secret parameters, `push-vapid-public-key`, `push-vapid-private-key`, `push-message-key`, handed to the API as `Push__VapidPublicKey`, `Push__VapidPrivateKey`, `Push__MessageKey` (design.md D5). Verify: build passes; the AppHost lists them (the local values come with task 54.1)
- [x] 3.4 `PushKeyEndpoint` `GET /api/push/key` → `{ publicKey }`, with its summary and description texts set in code; `PushDriver` and `PushDsl` for the key. Verify: group 1.2 compiles against it
- [x] 3.5 Regenerate the TS client (`npm --prefix tools/api-client run regenerate`); commit `openapi.json` and `schema.d.ts`. Verify: the frontend type check passes; CI's drift steps would pass
- [x] 3.6 Docs: configuration.md § `appsettings.json` is the inventory (`Push`), § Hand-provisioned secrets (three rows, provisioned in C8a, tasks 54.1 and 54.2), § Local development and tests (the three parameters), § Frontend (the first runtime value is served: the push key), and its `.claude/rules/` mirror. Verify: each names design.md D5

## 4. [close] Slice 1 — The app gets the public push key

- [x] 4.1 The scenario's test passes. Verify: green, including push-devices / The app gets the public push key

## 5. [unit] Slice 2 — The message

- [x] 5.1 A message becomes Declarative Web Push JSON with web_push 8030, its title, its text as body, and navigate at the app's address of its page
- [x] 5.2 A message without text leaves body out
- [x] 5.3 A message without a page navigates to the app's start page
- [x] 5.4 The JSON carries no badge and nothing else

## 6. [unit] Slice 2 — Registering a device

- [x] 6.1 A device at a known push service with well-formed keys is saved under the signed-in account
- [x] 6.2 A push address at a service named exactly is accepted
- [x] 6.3 A push address under a service named with a wildcard is accepted
- [x] 6.4 A plain-http push address is accepted only at a loopback service the settings name

## 7. [unit] Slice 2 — Sending

- [x] 7.1 Every device of an allowed account gets the message once
- [x] 7.2 Each push carries the message's Declarative Web Push JSON
- [x] 7.3 The answer counts the devices reached
- [x] 7.4 A send logs its counts only
- [x] 7.5 The right message key matches

## 8. [integration] Slice 2 — Push device store

- [x] 8.1 An empty store reads as no devices
- [x] 8.2 A saved device reads back with every field unchanged, a push address with a query included
- [x] 8.3 Saving the same push address again leaves one device with the latest keys
- [x] 8.4 Saving a push address under another account moves the device to it
- [x] 8.5 Forgetting a device removes it and leaves the others
- [x] 8.6 Forgetting a push address that is not stored does nothing
- [x] 8.7 A push address with a slash, a question mark and a hash reads back unchanged

## 9. [wiring] Slice 2 — Storage

- [x] 9.1 `PushDeviceStoreOptions` (section `PushDevices`, `TableName` default `pushdevices`, validated as C7b's), `TablePushDeviceStore`, `StorageRegistration.AddPushDeviceStore`, called in `Program.cs` after `AddTransactionStore`; `appsettings.json` gains the `PushDevices` section with its provenance comment (design.md D11). Verify: group 8's contract tests green on both stores
- [x] 9.2 Docs: README.md § Backend code (the device store's port in `Push/` and its adapter in `Storage/`; a storage failure is an exception); configuration.md (`PushDevices`); testing.md § Integration tests (the second contract); their `.claude/rules/` mirrors. Verify: each names design.md D11

## 9a. [acceptance] Slice 2 — The fake push service and the test device

Written by the test-writer, as every fake (the owner, 2026-11-09, after a review finding; design.md D7): these checks are the only test of RFC 8291 and RFC 8292, so the implementer, whose sending they judge, never writes them. No implementer step and no owner's gate (no scenario changes). The self-tests live outside `Drivers/` (which the implementer may edit in wiring groups) and outside `Scenarios/`; the implementer never edits `Drivers/FakePushService.cs`, `Drivers/TestDevice.cs` or `Drivers/ReceivedPush.cs`.

- [x] 9a.1 `TestDevice.Decrypt`: RFC 8291 on .NET's `ECDiffieHellman`, `HKDF` and `AesGcm`, never the library. Self-test: it reproduces RFC 8291 Appendix A's plaintext from its keys and body
- [x] 9a.2 `FakePushService`'s checks and record (design.md D7): the token an ES256 JWT signed with the run's VAPID key, `k` that key, `aud` the fake's scheme and host, `exp` in the future and at most 24 hours ahead, `sub` an `https:` address; `TTL` present; `Urgency`'s value checked only when present; `Content-Encoding: aes128gcm`; 403 when one fails, 201 otherwise; every request recorded (`ReceivedPush`). Self-tests: 403 for a push signed with another key, an expired `exp`, an `exp` more than 24 hours ahead, a wrong `aud`, no `TTL`, an unknown `Urgency`, another `Content-Encoding`; 201 for a correct push the test builds with its own code (never the library), with and without `Urgency`
- [x] 9a.3 `FakePushService.Gone` (410 from then on) and `FailsOnce` (500 once, then as before), with self-tests. Verify (whole group): the self-tests green; this change's acceptance tests still fail at runtime

## 10. [wiring] Slice 2 — Delivery and the endpoints

- [x] 10.1 `WebPushDelivery` on Lib.Net.Http.WebPush with its typed `HttpClient` (timeout `Push:RequestTimeout`, no resilience handler), the VAPID pair, `Subject` and the `vapid` scheme, its retries off (`AutoRetryAfter = false`); `TTL` and `Urgency` from each push (design.md D1, D13, the sketch's library names). Verify: `HttpClientDefaultsTests` stays green
- [x] 10.2 `SubscriptionEndpoint` `PUT /api/push/subscription` (the signed-in email → `RegisterDeviceHandler` → 204; its body declared with `Accepts<SubscriptionRequest>("application/json")`, D9); `MessageEndpoint` `POST /api/push/messages` (anonymous, excluded from the description, binds nothing; `MessageKeyCheck` first; the body read by hand; `SendPushHandler` → 200 with the three counts), as design.md D9, D10. Verify: build passes
- [x] 10.3 `Conventions/AnonymousEndpointsTests` gains `POST /api/push/messages` (an anonymous endpoint goes on the allowlist). Verify: the convention test is green
- [x] 10.4 Drivers: `PushDriver` for registering and sending, reading what reached each phone through the fake push service's record and the test device's decryption (group 9a, the test-writer's; never edited here) (design.md D7). Verify: the scenario's test runs to its assertions
- [x] 10.5 Regenerate the TS client; commit both files. Verify: `/api/push/messages` is in neither; the type check passes

## 11. [close] Slice 2 — A registered device receives a message sent to its account

- [x] 11.1 The scenario's test passes. Verify: green, including push-sending / A registered device receives a message sent to its account

## 12. [unit] Slice 3 — Only the account's devices

- [x] 12.1 A message goes only to the devices of the account it names
- [x] 12.2 Devices are matched to the account ignoring letter case

## 13. [close] Slice 3 — A message reaches every device of the account and none of another account's

- [x] 13.1 The scenario's test passes. Verify: green, including push-sending / A message reaches every device of the account and none of another account's

## 14. [unit] Slice 4 — Lifetime and urgency

- [x] 14.1 Every push the sender hands over lives 24 hours
- [x] 14.2 Every push the sender hands over is urgent

## 15. [close] Slice 4 — Every push lives 24 hours and is urgent

- [x] 15.1 The scenario's test passes. Verify: green, including push-sending / Every push lives 24 hours and is urgent

## 16. [unit] Slice 5 — No devices

- [x] 16.1 An allowed account with no devices gets zero counts and no push is handed over

## 17. [close] Slice 5 — An allowed account with no devices gets zero counts

- [x] 17.1 The scenario's test passes. Verify: green, including push-sending / An allowed account with no devices gets zero counts

## 18. [unit] Slice 6 — The message key and the hidden endpoint

- [x] 18.1 A wrong message key does not match
- [x] 18.2 A missing message key does not match
- [x] 18.3 A message key sent twice does not match
- [x] 18.4 A message key of another length does not match
- [x] 18.5 The message endpoint is not in the API description (`Conventions/HiddenEndpointsTests`, reading the committed `openapi.json`)
- [x] 18.6 At the message endpoint, a request without the key header (with a valid body, and with a malformed body) and one with the header twice get the answer of an unknown `/api` address, compared whole apart from `traceId` (design.md D10; review finding R6). Written by the test-writer, in `IntegrationTests/Wiring/Push/`; may be already green, since the endpoint checks the key before reading the body

## 19. [wiring] Slice 6 — The keyless answer

- [x] 19.1 `MessageEndpoint` answers a missing or wrong key with `TypedResults.NotFound()` before reading the body, so a keyless request with a malformed body gets the same 404 (design.md D10). Verify: the scenario's test compares the answer whole, apart from `traceId`, with an unknown `/api` address's

## 20. [close] Slice 6 — A message without the right key gets the answer of an unknown address

- [x] 20.1 The scenario's test passes. Verify: green, including push-sending / A message without the right key gets the answer of an unknown address

## 21. [unit] Slice 7 — Accounts not on the allowlist

- [x] 21.1 A message to an account not on the allowlist is refused and nothing is handed over
- [x] 21.2 A refused account is logged without its address

## 22. [wiring] Slice 7 — The refusal's problem

- [x] 22.1 `MessageEndpoint` answers `AccountNotAllowed` with 404, `type` `/problems/push-account-not-allowed`, title `Account not allowed`. Verify: the scenario's test reads that problem
- [x] 22.2 Docs: README.md § Backend code, the case → status table's row (design.md § Error model), and its mirror. Verify: the row names the scenario

## 23. [close] Slice 7 — A message to an account not on the allowlist is refused

- [x] 23.1 The scenario's test passes. Verify: green, including push-sending / A message to an account not on the allowlist is refused

## 24. [unit] Slice 8 — Devices of a refused account

- [x] 24.1 A message to an account not on the allowlist deletes the devices still registered under it
- [x] 24.2 Those devices are matched ignoring letter case, and other accounts' devices stay
- [x] 24.3 The number of deleted devices is logged

## 25. [wiring] Slice 8 — A device registered before its account left the list

- [x] 25.1 `PushDriver` saves a device for a made-up account through the app copy's `IPushDeviceStore`, and reads whether a push address is still registered (design.md § How each scenario is verified). Verify: the scenario's test runs to its assertions

## 26. [close] Slice 8 — A message to an account no longer on the allowlist deletes its devices

- [x] 26.1 The scenario's test passes. Verify: green, including push-sending / A message to an account no longer on the allowlist deletes its devices

## 27. [unit] Slice 9 — A message's title and account

- [x] 27.1 A message without a title is refused, naming the title
- [x] 27.2 A message whose title is only spaces is refused, naming the title
- [x] 27.3 A message without an account is refused, naming the account
- [x] 27.4 The sender refuses a message the rules refuse with an argument error

## 28. [wiring] Slice 9 — Refusals as problem descriptions

- [x] 28.1 `MessageEndpoint` applies `PushMessages.Check` and the account rule before calling the sender and answers FastEndpoints' validation 400 naming each refused member with its fixed reason; a body that is not the request's JSON answers 400 naming `body` (design.md D10). Verify: the scenario's test reads the member; no value appears in the problem

## 29. [close] Slice 9 — A message without a title is refused

- [x] 29.1 The scenario's test passes. Verify: green, including push-sending / A message without a title is refused

## 30. [unit] Slice 10 — Pages of the app

- [x] 30.1 `/` and a path under it, with or without a query, are pages of the app
- [x] 30.2 An absolute address is not a page of the app
- [x] 30.3 A path starting with two slashes or a slash and a backslash is not a page of the app
- [x] 30.4 A path under `/api` is not a page of the app
- [x] 30.5 An empty page is not a page of the app
- [x] 30.6 A message whose page is not a page of the app is refused, naming the page

## 31. [close] Slice 10 — A message whose page is not a page of the app is refused

- [x] 31.1 The scenario's test passes. Verify: green, including push-sending / A message whose page is not a page of the app is refused

## 32. [unit] Slice 11 — The size of a push

- [x] 32.1 A message whose JSON is exactly 3993 bytes is accepted
- [x] 32.2 A message whose JSON is 3994 bytes is refused, naming the message
- [x] 32.3 The size counts UTF-8 bytes, so Czech letters count twice

## 33. [close] Slice 11 — A message too long for a push is refused

- [x] 33.1 The scenario's test passes. Verify: green, including push-sending / A message too long for a push is refused

## 34. [unit] Slice 12 — Gone devices

- [x] 34.1 A device the push service reports gone is forgotten and counted as removed
- [x] 34.2 A gone device is logged with the status only
- [x] 34.3 The other devices of the account still get the message

## 35. [wiring] Slice 12 — Gone at the push service

- [x] 35.1 `WebPushDelivery` answers `DeviceGone` for 404 and 410 (`FakePushService.Gone` is group 9a's); edge tests in `IntegrationTests/Wiring/WebPush/` against WireMock for 404 and 410 (design.md D13). Verify: the edge tests green

## 36. [close] Slice 12 — A device the push service reports gone is deleted

- [x] 36.1 The scenario's test passes. Verify: green, including push-sending / A device the push service reports gone is deleted

## 37. [unit] Slice 13 — Failing push services

- [x] 37.1 A device whose push fails is counted as failed and kept
- [x] 37.2 A failed push is logged with its status, or none when no answer came
- [x] 37.3 A failed push is not handed over again

## 38. [wiring] Slice 13 — Failures at the push service

- [x] 38.1 `WebPushDelivery` answers `DeliveryFailed` for any other status, no connection and its own timeout, and passes the caller's cancellation on (`FakePushService.FailsOnce` is group 9a's); edge tests in `IntegrationTests/Wiring/WebPush/` for 429 (one request, never retried), 500, no connection, the timeout (a short `RequestTimeout`) and the caller's cancellation. Verify: the edge tests green

## 39. [close] Slice 13 — A device whose push service fails is counted as failed and kept

- [x] 39.1 The scenario's test passes. Verify: green, including push-sending / A device whose push service fails is counted as failed and kept

## 40. [unit] Slice 14 — Registering again

- [x] 40.1 Registering a stored push address under another account saves it under the new account

## 41. [close] Slice 14 — Registering the same device again moves it to the account signed in now

- [x] 41.1 The scenario's test passes. Verify: green, including push-devices / Registering the same device again moves it to the account signed in now

## 42. [unit] Slice 15 — Known push services

- [x] 42.1 A push address at a host no service names is refused, naming the push address
- [x] 42.2 A host that only looks like a service's (`push.apple.com.example.com`, `evilpush.apple.com`) is refused
- [x] 42.3 A push address on another port than its service's is refused
- [x] 42.4 A plain-http push address at a service named with https is refused
- [x] 42.5 A push address with user information is refused
- [x] 42.6 A push address longer than 2048 characters is refused
- [x] 42.7 A missing or relative push address is refused
- [x] 42.8 A service pattern with a path, a query, a wildcard not at its start, or plain http on a host that is not loopback fails validation
- [x] 42.9 A refused subscription stores nothing

## 43. [wiring] Slice 15 — The subscription's refusal

- [x] 43.1 `SubscriptionEndpoint` answers `SubscriptionRefused` with FastEndpoints' validation 400 naming each member, never a value (design.md D9). Verify: the scenario's test reads the member
- [x] 43.2 Docs: deployment.md, the guided task for the production keys (design.md D5: the PowerShell 7 block, written as C6's in entra-id.md, with the subscription named; values never printed; the read-back lists names only), with its laptop variant for the user-secrets and the backup vault, and local-secrets.md's three rows and their backups. Verify: the block runs in the owner's shell (tasks 54.1 and 54.2)

## 44. [close] Slice 15 — A push address outside the known push services is refused

- [x] 44.1 The scenario's test passes. Verify: green, including push-devices / A push address outside the known push services is refused

## 45. [unit] Slice 16 — The device's keys

- [x] 45.1 A missing public key is refused, naming it
- [x] 45.2 A public key that is not 65 bytes starting with 0x04 is refused, naming it
- [x] 45.3 A key that is not base64url is refused, naming it
- [x] 45.4 A missing secret is refused, naming it
- [x] 45.5 A secret that is not 16 bytes is refused, naming it
- [x] 45.6 A public key of 65 bytes starting with 0x04 that is not a point on P-256 is refused, naming it (design.md D9)

## 46. [close] Slice 16 — A subscription with missing or wrong-sized keys is refused

- [x] 46.1 The scenario's test passes. Verify: green, including push-devices / A subscription with missing or wrong-sized keys is refused

## 47. [unit] Slice 17 — Forgetting a device

- [x] 47.1 Forgetting a stored device removes it

## 48. [wiring] Slice 17 — The forget endpoint

- [x] 48.1 `ForgetSubscriptionEndpoint` `DELETE /api/push/subscription` with `{ endpoint }` in its body → `ForgetDeviceHandler` → 204, its body declared with `Accepts<ForgetSubscriptionRequest>("application/json")` (design.md D9); `PushDriver` and `PushDsl` for forgetting. Verify: build passes
- [x] 48.2 Regenerate the TS client; commit both files. Verify: the type check passes

## 49. [close] Slice 17 — A forgotten device gets no more messages

- [x] 49.1 The scenario's test passes. Verify: green, including push-devices / A forgotten device gets no more messages

## 50. [unit] Slice 18 — Forgetting nothing

- [x] 50.1 Forgetting a push address that is not stored is fine
- [x] 50.2 Forgetting without a push address is fine

## 51. [close] Slice 18 — Forgetting a device that was never registered is fine

- [ ] 51.1 The scenario's test passes. Verify: green, including push-devices / Forgetting a device that was never registered is fine

## 52. [unit] The shared frontend pieces (design.md D8)

The test-writer also writes `src/test/push.ts` (the stand-ins for `Notification`, `PushManager` and the service worker registration, removed after each test) and the fake server's answers to the three push addresses in `src/test/server.ts`.

- [ ] 52.1 Reading the push key answers the key
- [ ] 52.2 Reading the push key answers signed out, refused, unexpected or offline as every read does
- [ ] 52.3 Sending a subscription sends the browser's own subscription JSON and answers done on 204
- [ ] 52.4 Sending a subscription the server refuses answers refused subscription
- [ ] 52.5 Forgetting a subscription sends its push address in the body and answers done on 204
- [ ] 52.6 Sending or forgetting answers offline without sending while the phone says it is offline
- [ ] 52.7 Push is supported only with a service worker, PushManager and Notification
- [ ] 52.8 Subscribing asks for visible pushes only, with the server's key as bytes
- [ ] 52.9 The current subscription is the registration's, or none
- [ ] 52.10 A subscription's key reads back in base64url, and it was made with a key exactly when the two are equal
- [ ] 52.11 Unsubscribing answers whether the browser unsubscribed
- [ ] 52.12 base64url turns into bytes and back unchanged, without padding

## 53. [unit] Guards

- [ ] 53.1 A registration and a send log no key, email address, title or text, and no push address outside the push client's own request lines (`Conventions/PushTelemetryTests`, design.md D4)

## 54. [wiring] Deployment

- [ ] 54.1 Guided (the owner): the laptop's push keys, with the laptop variant of task 43.2's block, into the AppHost's user-secrets and the backup vault (design.md D5). Verify: Claude lists the three user-secrets names and the three backup names, never values
- [ ] 54.2 Guided (the owner, before the merge): the production push keys into Key Vault with the block from task 43.2 (design.md D5). Verify: Claude lists the vault's secret names read-only and finds `Push--VapidPublicKey`, `Push--VapidPrivateKey`, `Push--MessageKey`, never values
- [ ] 54.3 Update infra Bicep + `.bicepparam` as design.md D12 describes: `platform.bicep` (the `pushdevices` table; the environment's default domain as an output), `features.bicep` (section "Push (C8)": three Key Vault references and four settings; the app's name as one variable), `main.bicep` (the domain passed on); no `.bicepparam` change. Verify: `az bicep lint --file infra/main.bicep` clean
- [ ] 54.4 The read-only preview (deployment.md § Previewing a change to the Bicep, with the owner's login). Verify: it shows exactly the table, three secrets and four settings on the container app
- [ ] 54.5 Docs: deployment.md (the deployed table; § Sending a test message, design.md D6; the after-merge checks of design.md § Migration plan, step 4); expiring-approvals.md (the three keys: no expiry, how to restore, a lost key heals itself); azure-prerequisites.md step 5 (design.md D16's dated note). Verify: each names design.md

## 55. [close] Acceptance green

- [ ] 55.1 All 18 acceptance tests of this change pass, and the full suite is green; the traceability check passes; `dotnet format whitespace --verify-no-changes` and the frontend checks are clean; `az bicep lint` is clean
- [ ] 55.2 Local check with `aspire start --isolated` (design.md § Migration plan, step 2; the laptop keys passed as `Parameters__*` environment variables from the worktree, never written to the shared user-secrets): the push key in the signed-in browser; a message to the owner's account answers three zeros; a wrong key answers as an unknown address. Verify: the owner sees each
- [ ] 55.3 Docs: ADR-0010-web-push (design.md D15), linked from docs/adr/README.md; testing.md § Decided later and a § Fake push service (design.md D7); their `.claude/rules/` mirrors. Verify: the ADR's decisions match design.md D1–D3, D5 and D10
- [ ] 55.4 Docs: the software-factory lessons and inventory lines of design.md D17. Verify: each names the decision it records
- [ ] 55.5 `pm/progress.md`: C8a's row (status, the change link, notes); `CLAUDE.md` § Commands (the quick start's push values, task 3.2). Verify: the row links the change

## Workflow follow-up

- The push and a draft PR on the owner's go; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; `/opsx:archive` on the branch; the PR ready, CI green, squash merge (workflow.md § 6).
- After the merge: design.md § Migration plan, step 4.
