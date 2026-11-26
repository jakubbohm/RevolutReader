# Spike: the balance from a notification, on the iPhone

**Issue:** [#113](https://github.com/jakubbohm/RevolutReader/issues/113), for [#91](https://github.com/jakubbohm/RevolutReader/issues/91) · **Run:** 2026-11-26 23:12 to 2026-11-27 00:17 (Prague), on the owner's iPhone, iOS 27.2.1, in the app installed on the Home Screen · **Verdict:** 2026-11-27: the balance can come from the notification's address, not from its `data` (see § Verdict) · **Test code:** PRs [#114](https://github.com/jakubbohm/RevolutReader/pull/114), [#116](https://github.com/jakubbohm/RevolutReader/pull/116) and [#117](https://github.com/jakubbohm/RevolutReader/pull/117), deployed for the run and reverted by the PR that adds this README

## Question

iOS holds some balance pushes for an hour ([#91's cause comment](https://github.com/jakubbohm/RevolutReader/issues/91#issuecomment-7189303142)). The fix found there sends them without `mutable`, so iOS shows them at once. But then the service worker no longer runs for a push, and the phone no longer keeps the pushed balance (c015). Two ways to get the balance back rest on closed-source iOS behaviour:

- **Option 2 (preferred):** at start, the app asks for its notifications still in Notification Center (`registration.getNotifications()`) and takes the balance from their `data`.
- **Option 1 (fallback):** the balance after a `#` in the notification's `navigate` address, read by the app when a tap opens it.

The four questions:

1. Does `getNotifications()` in the Home Screen app list the notifications iOS showed by itself from plain pushes (no `mutable`), each with its `data`?
2. After a tap on one, is the tapped notification still listed when the app asks: (a) with the app closed, (b) with it in the background?
3. Opened from its icon, does the app see the notifications still in Notification Center? Does opening the app remove them?
4. Does the `#…` part of `navigate` reach the app on a tap: (a) with the app closed, (b) with it in the background (a reload, or only a `hashchange`)?

## Why it ran in the deployed app

The answers depend on the app exactly as it ships: its address, its service worker, its install on the Home Screen with its push subscription, and the push the server builds, sent through Apple's push service. A twin app at another address would have needed its own hosting, install, permission, push keys and sender, and would still have tested a twin. So the test code went into the app itself, for the run only:

- **Server:** the owner's message (`POST /api/push/messages`, which already sends a plain push and takes the page a tap opens) took an optional made-up balance, sent in the notification's `data` under `test`. It was never under `balance`, so a desktop browser, whose service worker still runs for every push, could never take it for the real balance or report its arrival. It was never `mutable`, and never logged.
- **App:** from the first moment of every start, and whenever the app came back to the front, its `#` changed or the browser restored it from its back-forward cache, it recorded what `getNotifications()` listed, with the event, the time, the address and the visibility, in the phone's own storage only. Test notifications were recorded in full; every other notification was only counted, so nothing of a real balance was recorded.
- **A test page** at an address nothing linked to, `/test/notifications`, showed the record. It sent no request at all.
- **Follow-ups:** the first run listed the test notifications, but without a usable `data`. So #116 told test notifications by their title ("Test n") and recorded their `data` as it came. When that showed `null`, #117 recorded their `navigate` address too.
- Nothing changed for the daughter: a message goes to one account.

## Steps

The owner sent each test message from PowerShell to the owner's own account, with a made-up balance, the title "Test n" and the address `/test/notifications#tn`. The record, transcribed: [evidence/2026-11-26-iphone-record.md](evidence/2026-11-26-iphone-record.md).

| # | Step | Record entries |
|---|---|---|
| 0 | Open the app once, so the phone takes the new version | #1 |
| 1 | With the app closed: send a test message and tap it (Test 1; again with Test 2) | #3, #6 |
| 2 | With the app in the background on the test page: the same (Test 3) | #7, #8 |
| 3 | Send two (Test 4, Test 5), tap neither, open the app from its icon, then once more; then tap Test 5 with the app in the background on `/` | #9–#13 |
| 3b | After #116: Test 6 and Test 7, open from the icon, tap Test 7 | #20–#22 |
| 3c | After #117: Test 8 and Test 9, open from the icon, tap Test 9 | #27–#29 |
| 4 | Clear the test notifications from Notification Center | |

## Answers

1. **Listed: yes. With their `data`: no.** Opened from its icon, the app listed every notification iOS had shown by itself (#9, #20, #27). Each came with its title, its text and its `navigate` address, `#` included (`https://<app>/test/notifications#t9`, #27), but its `data` was `null` (#20, #27), though the push carried it.
2. **No, in every case.** By the time the app asked, the tapped notification was gone, from the list and from Notification Center, and the others stayed:
   - (a) with the app closed (#3, #6);
   - (b) with it in the background on the test page (#7, #8);
   - with it in the background on another page (#12, #21, #28).
3. **Yes, and no.** Opened from its icon, the app listed every notification still in Notification Center (#9, #20, #27). Opening it removed none (#9–#11), as Notification Center showed too.
4. **Yes, both.**
   - (a) **App closed:** the app starts with the `#` in its address (`location.hash`), loaded by "navigate" (#3, #6).
   - (b) **In the background on the same page:** no reload, only a `hashchange`, fired while the page was still hidden; it turned visible 7 ms later (#7, #8).
   - **In the background on another page:** the app first comes back to the front, with the tapped notification already gone. Then a full load of the tapped address, `#` included, follows 80 to 173 ms later (#12–#13, #21–#22, #28–#29).

## Why `data` is `null`

WebKit's open-source code (main branch, read 2026-11-27) does exactly what the phone showed:

- The parser of a declarative push reads the notification's `data` (`Source/WebCore/Modules/notifications/NotificationJSONParser.cpp`).
- A declarative push without `mutable` is shown by the push daemon itself (`Source/WebKit/webpushd/WebPushDaemon.mm`, `handleIncomingPushImpl`). It builds the notification with `NotificationPayload::toNotificationData()` (`NotificationPayload.cpp`), which copies the `navigate` address, title, text, direction, language, tag, icon and `silent`, **but not `data`**.
- Only the path into a service worker's `push` event (a `mutable` push) turns the declarative `data` into the notification's `data` (`Notification.cpp`, `Notification::create` from a payload).
- `getNotifications()` rebuilds each listed notification from what the daemon stored (`WebPushDaemon::getNotifications`), and `navigate` is part of a notification (`Notification.idl`, behind the Declarative Web Push setting). So a listed notification has its `navigate`, `#` included, and a `null` `data`.

#91's cause comment read the listing (`WebPushDaemon::getNotifications`) and expected the `data` there. It is lost one step earlier, when the daemon shows the notification by itself.

## Unexpected

- **iOS removed the app's five older real notifications at the tap on Test 5** (#12 listed them, #13 173 ms later did not, and Notification Center agreed). They had been shown by the service worker from `mutable` balance pushes before the test. The app closes no notification itself. It happened at no other tap, when only test notifications were in Notification Center, and they stayed. The cause is unknown (closed source). So a notification still in Notification Center is not guaranteed to stay there until the app opens.
- **The tapped notification is never listed** (question 2), so a tap carries its balance only in the address the tap opens.

## Verdict

**2026-11-27, iOS 27.2.1:**

- **Option 2 as planned, the balance from the notification's `data`: no.** iOS drops `data` from every notification it shows by itself.
- **Option 1, the balance after the `#` in `navigate`: yes, for both ways the app is opened:**
  - **A tap:** the app reads it from its own address. With the app closed it is there at the start; in the background it comes as a `hashchange` or with a full load.
  - **An open from the icon, or a return to the front:** the app reads it from the `navigate` address of each notification `getNotifications()` lists, as long as the notification is still in Notification Center.
- **The two differ in trust.** A listed notification's address can only come from a push the server sent. The app's own address can come from any link, so a tap's balance needs the check #91's cause comment names (a signature), or the risk of a made-up balance shown until the live read replaces it. The fix's proposal chooses.
- **Leftover:** every phone that opened the app while the test code was live keeps its record in `localStorage` (`tarjeta-papa.notification-test.record`), at most 100 entries of times, addresses and counts. Nothing reads it any more. #91's fix may delete it.
