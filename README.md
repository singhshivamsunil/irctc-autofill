# IRCTC Passenger Autofill

A Chrome/Edge extension that takes over from the moment you click **Book Now** and gets you to the payment page.
You log in, search, pick the train, click Book Now, type any captcha and pay.

## The panel

Every IRCTC page gets an **IRCTC Autofill** panel on the right. It has:

- **Fill after Book Now:** the on/off switch. While it's on, the extension waits for you to click Book Now. The
  setting is remembered across tabs and restarts.
- a status line saying what it's waiting for or what it just did, with red lines if it stopped
- your saved passengers
- a **Book only if confirm berths are allotted** line: your setting (On/Off) before the run, then, once the
  passenger page is done, whether the box is ticked on IRCTC's page (or not offered, for a waitlisted class). It
  stays there through the review and payment pages.
- **Edit passengers**, which opens the options page
- **Copy details**, which copies what happened on the last run and the name boxes' HTML, so a problem can be fixed.
  It includes your master list names.

Click **–** to shrink the panel to a tab on the right edge. The toolbar button brings it back.

## What happens after Book Now

| Page | What it does |
|---|---|
| Train list | Nothing. Your own click on **Book Now** starts it, if the switch is on. A script-generated click doesn't. |
| Passenger details | Selects passenger 1 from the master list dropdown, clicks **+ Add Passenger**, selects passenger 2, and so on, then presses **Continue**. If IRCTC won't add a row, the panel shows IRCTC's message. |
| Review journey | Presses **Continue**. If there's a captcha, it puts the cursor in the captcha box instead. You type it and press Enter. |
| Payment | Selects your payment option (E-Wallet by default) and stops. You press **Pay & Book**. |

Each page is handled as soon as IRCTC renders it. If IRCTC is slow, it waits up to 10 minutes for each page. It
never sends a request again, never types a captcha, and never pays.

### Waiting for the right moment

Each step only runs on its own IRCTC page (`/nget/booking/psgninput`, `/nget/booking/reviewBooking`,
`/nget/payment/bkgPaymentOptions`) and only when nothing is in front of it:

- **Prompts:** if IRCTC shows a prompt or confirmation after Book Now or while the passengers are being filled, it
  waits. It never answers prompts. Once you close or answer the prompt, it carries on where it left off.
- **Loading:** while IRCTC's loading screen is showing, it waits.

While it waits, an amber line in the panel says what for, for example: Waiting: the "Confirmation" prompt is open.

## Install

1. Open `edge://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder. If it's already loaded, click its reload arrow instead.
3. Click **Details → Extension options**, enter your passengers' full names, and click **Save**.
4. Reload any IRCTC tab that was already open, then turn on the switch in the panel.

## Passengers

Enter each passenger's full name exactly as it appears in your IRCTC master list. Capital letters and extra spaces
don't matter. Up to 6 passengers, in booking order.

IRCTC's name box opens the whole master list when it gets focus; each entry reads "Full Name | 38 yrs | Male". The
extension focuses each box, clicks the entry with that full name, and IRCTC fills in age, gender and the rest. It
doesn't type anything or touch any other option on the page. It picks by the whole name, so "Ravi Kumar" never
selects "Ravi Kumar Verma" or "Meena Ravi Kumar".

### Book only if confirm berths are allotted

Tick this in Options to have it ticked on IRCTC's passenger page (the `confirmberths` checkbox under Other
Preferences) before Continue is pressed. Nothing else in Other Preferences is changed.

IRCTC only shows the checkbox when the class isn't waitlisted. If it's missing, the extension stops before Continue
and says so, so you can decide whether to book without it.

Right after Book Now, IRCTC may still be loading the master list, so it keeps reopening the dropdown for up to 8
seconds per passenger. If a name still isn't there, it stops before Continue, and the panel names the passenger and
what the dropdown listed.

## Other ways to start it

The shortcut **Alt+Shift+F** handles whichever booking page is open (passenger, review or payment) and carries on
from there, whether or not the switch is on. You can change it at `edge://extensions/shortcuts`.

## If something goes wrong

The panel says what it couldn't do. For more, click **Copy details** and paste it in the chat. To capture the open
dropdown, click into a name box so the list shows, then click **Copy details**.

The page matching is based on the recording in `manual_flow/flow.txt` and the saved passenger page next to it:
`app-passenger` rows with a PrimeNG autocomplete name box, `app-review-booking`, and `.bank-type` tiles in
`app-payment-options`.

## Test

```
node test/run-mock.mjs
```

This runs `content.js` in headless Edge or Chrome against `test/mock-irctc.html`, a local copy of the flow from
train list to payment whose name box behaves like IRCTC's (PrimeNG's AutoComplete as IRCTC's code sets it up). Each
run starts with a real mouse click on Book Now. It covers:

- the panel
- a review page with and without a captcha
- a master list that loads late
- a prompt after Book Now, the loading screen, and a prompt on the passenger page
- a name that isn't in the master list
- a script-generated Book Now click, which must be ignored
- the switch turned off
