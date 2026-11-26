# The iPhone's record, 2026-11-26/27

Transcribed from the owner's screenshots of the test page (the screenshots are not committed). The owner's iPhone, iOS 27.2.1, the app installed on the Home Screen. Times are the phone's (Prague, UTC+1).

- **Listed:** what `registration.getNotifications()` answered, as test notifications / others, and after how many milliseconds.
- **Others:** only ever counted. Nothing of a real notification was recorded.
- **Test notifications:** the owner's test messages, titled "Test n", with the text "Vymyšlený zůstatek, jen zkouška", a made-up balance and the address `/test/notifications#tn`.
- **Missing entries:** #14–#18 and #23–#26 were not on a screenshot.

## Run 1: the first test version, 2026-11-26

Test notifications were told apart by a `test` member in their `data`.

| # | Event | Time | Address | Visible | Loaded by | Listed | Step and note |
|---|---|---|---|---|---|---|---|
| 1 | start | 23:12:33.844 | `/` | yes | reload | 0 / 5 (23 ms) | Step 0: the new version took over with a reload |
| 2 | start | 23:18:43.944 | `/` | yes | navigate | 0 / 5 (27 ms) | Probably opened from the icon |
| 3 | start | 23:19:48.671 | `/test/notifications#t1` | yes | navigate | 0 / 5 (17 ms) | Step 1: tap on Test 1, app closed. Notification Center afterwards: the 5 older notifications, no Test 1 |
| 4 | front | 23:22:32.994 | `…#t1` | yes | | 0 / 5 (20 ms) | Back to the app, then closed |
| 5 | start | 23:28:07.842 | `/` | yes | navigate | 0 / 5 (17 ms) | Opened from the icon |
| 6 | start | 23:28:57.150 | `…#t2` | yes | navigate | 0 / 5 (16 ms) | Step 1 again: tap on Test 2, app closed |
| 7 | # change | 23:29:32.688 | `…#t3` | no | | 0 / 5 (19 ms) | Step 2: tap on Test 3, app in the background on the test page. The same page as #6 (started 23:28:57.150): no reload, and the page still hidden |
| 8 | front | 23:29:32.695 | `…#t3` | yes | | 0 / 5 (46 ms) | 7 ms after #7 |
| 9 | start | 23:33:32.216 | `/` | yes | navigate | 0 / 7 (18 ms) | Step 3: Test 4 and Test 5 arrived, neither tapped; opened from the icon. 7 = the 5 older + Test 4 + Test 5, counted as others because their `data` had no `test` |
| 10 | front | 23:34:12.265 | `/` | yes | | 0 / 7 (16 ms) | Back after a look at Notification Center: Test 4 and Test 5 still there |
| 11 | front | 23:34:27.093 | `/` | yes | | 0 / 7 (11 ms) | Opened from the icon again, from the background: both still there |
| 12 | front | 23:35:16.204 | `/` | yes | | 0 / 6 (33 ms) | Tap on Test 5, app in the background on `/`: first back to the front, with Test 5 already gone |
| 13 | start | 23:35:16.377 | `…#t5` | yes | navigate | 0 / 1 (28 ms) | 173 ms later, a full load of the tapped address. Only Test 4 listed: the 5 older notifications were gone, from Notification Center too |

## Run 2: test notifications told by their title, `data` recorded as it came

| # | Event | Time | Address | Visible | Loaded by | Listed | Step and note |
|---|---|---|---|---|---|---|---|
| 19 | start | 23:58:42.552 | `/` | yes | navigate | 1 / 0 (16 ms) | Opened from the icon before the next messages: Test 4 |
| 20 | start | 23:59:18.713 | `/` | yes | navigate | 3 / 0 (24 ms) | Test 6 and Test 7 arrived, neither tapped; opened from the icon. Test 7, Test 6, Test 4: `data` is `null` for each |
| 21 | front | 23:59:34.490 | `/` | yes | | 2 / 0 (9 ms) | Tap on Test 7, app in the background on `/`: back to the front, with Test 7 already gone |
| 22 | start | 23:59:34.570 | `…#t7` | yes | navigate | 2 / 0 (22 ms) | 80 ms later, a full load. Test 6 and Test 4 stayed, in Notification Center too |

## Run 3: the `navigate` address recorded too, 2026-11-27

| # | Event | Time | Address | Visible | Loaded by | Listed | Step and note |
|---|---|---|---|---|---|---|---|
| 27 | start | 00:16:51.669 | `/` | yes | navigate | 4 / 0 (13 ms) | Test 8 and Test 9 arrived, neither tapped; opened from the icon. Test 9, 8, 6 and 4: `data` is `null`, and `navigate` is a string, the full address with its `#`: `https://<app>/test/notifications#t9` (`#t8`, `#t6`, `#t4`) |
| 28 | front | 00:17:07.349 | `/` | yes | | 3 / 0 (9 ms) | Tap on Test 9: back to the front, with Test 9 already gone. Test 8, 6 and 4, each with its `navigate` |
| 29 | start | 00:17:07.431 | `…#t9` | yes | navigate | 3 / 0 (20 ms) | 82 ms later, a full load. Test 8, 6 and 4 stayed |
