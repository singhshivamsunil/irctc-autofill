# IRCTC Passenger Autofill

A Chrome/Edge extension that takes over from the moment you click **Book Now** and gets you to the payment page.
You log in, search, pick the train, click Book Now, type any captcha and pay. If you turn on **Complete payment**, it
also pays from your IRCTC eWallet.

## The panel

Every IRCTC page gets an **IRCTC Autofill** panel on the right. It has:

- **Fill after Book Now:** the on/off switch. While it's on, the extension waits for you to click Book Now. The
  setting is remembered across tabs and restarts.
- **Complete payment (E-Wallet):** off unless you turn it on (it turns orange). See
  [Complete payment](#complete-payment-e-wallet). Also remembered, and it takes effect straight away, even mid-run.
- a status line saying what it's waiting for or what it just did, with red lines if it stopped
- your saved passengers
- a **Book only if confirm berths are allotted** line: your setting (On/Off) before the run, then, once the
  passenger page is done, whether the box is ticked on IRCTC's page (or not offered, for a waitlisted class). It
  stays there through the review and payment pages.
- **Edit passengers**, which opens the options page
- **Copy details**, which copies what happened on the last run and the name boxes' HTML, so a problem can be fixed.
  It includes your master list names.

Click **–** to shrink the panel to a tab on the right edge. The toolbar button brings it back.

### The two switches together

| Fill after Book Now | Complete payment | What happens after you click Book Now |
|---|---|---|
| Off | Off | Nothing. You book by hand. |
| On | Off | Selects the passengers, presses Continue on the passenger and review pages, selects your payment option, then stops. You pay. |
| On | On | The same, then presses **Pay & Book** and **CONFIRM** (E-Wallet only). |
| Off | On | Nothing. Complete payment only acts during a run. |

The **Alt+Shift+F** shortcut is the exception: it runs even with Fill after Book Now off, starting from whichever
booking page is open. It pays only if Complete payment is on, so leave that off if you only want the shortcut to
fill.

## What happens after Book Now

| Page | What it does |
|---|---|
| Train list | Nothing. Your own click on **Book Now** starts it, if the switch is on. A script-generated click doesn't. |
| Passenger details | Selects passenger 1 from the master list dropdown, clicks **+ Add Passenger**, selects passenger 2, and so on, then presses **Continue**. If IRCTC won't add a row, the panel shows IRCTC's message. |
| Review journey | Presses **Continue**. If there's a captcha, it puts the cursor in the captcha box instead. You type it and press Enter. |
| Payment | Selects your payment option (E-Wallet by default) and stops. You press **Pay & Book**. With **Complete payment** on, it presses Pay & Book itself (E-Wallet only). |
| eWallet confirmation | Only with **Complete payment** on: presses **CONFIRM**, unless IRCTC asks for an OTP. |

Each page is handled as soon as IRCTC renders it. If IRCTC is slow, it waits up to 10 minutes for each page. It
never types a captcha or OTP and never answers IRCTC's prompts, and it only pays when Complete payment is on.

### Waiting for the right moment

Each step only runs on its own IRCTC page (`/nget/booking/psgninput`, `/nget/booking/reviewBooking`,
`/nget/payment/bkgPaymentOptions`, `/nget/payment/ewallet-confirm`) and only when nothing is in front of it:

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

## Complete payment (E-Wallet)

With the panel's **Complete payment (E-Wallet)** switch on, after selecting E-Wallet on the payment page it:

1. presses **Pay & Book**. IRCTC starts the payment and opens its eWallet confirmation page, which shows your balance
   and the amount to deduct.
2. presses **CONFIRM** there. IRCTC takes the money from your eWallet and books the ticket; the result shows on the
   page, and the panel shows the amount.

Safeguards:

- **E-Wallet only.** With any other payment option saved, it selects that option and stops before Pay & Book. It
  also waits until IRCTC shows E-Wallet as the chosen option.
- **Once.** It presses Pay & Book and CONFIRM once each. If IRCTC shows an error after Pay & Book (for example, not
  enough balance), the panel shows IRCTC's message and it stops.
- **OTP.** If the eWallet page asks for an OTP, it puts the cursor in the OTP box and leaves CONFIRM to you. On that
  page, IRCTC logs you out if CONFIRM is pressed without typing the OTP.
- **Prompts.** It never answers IRCTC's prompts, including "Retry Booking Confirmation".
- **Mid-run.** The switch is read when it's needed, so turning it off during a run stops it before Pay & Book or
  CONFIRM.

IRCTC itself holds the payment until a minimum time after Pay & Book has passed, so pressing CONFIRM straight away
doesn't get the booking rejected; IRCTC just keeps its loading screen up a little longer.

## Other ways to start it

The shortcut **Alt+Shift+F** handles whichever booking page is open (passenger, review, payment or eWallet
confirmation) and carries on from there, whether or not the Fill after Book Now switch is on. Complete payment still
decides whether it pays. You can change it at `edge://extensions/shortcuts`.

## If something goes wrong

The panel says what it couldn't do. For more, click **Copy details** and paste it in the chat. To capture the open
dropdown, click into a name box so the list shows, then click **Copy details**.

The page matching is based on the recording in `manual_flow/flow.txt` and the saved pages next to it (kept out of
git: they hold personal details): `app-passenger` rows with a PrimeNG autocomplete name box, `app-review-booking`,
`.bank-type` tiles and the Pay & Book button in `app-payment-options`, and CONFIRM in `app-ewallet-confirm`.

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
- Book only if confirm berths are allotted, and a waitlisted class that doesn't offer it
- Complete payment: Pay & Book and CONFIRM pressed once each, an eWallet page that asks for an OTP, IRCTC refusing
  the payment, a payment option other than E-Wallet, and the switch turned off mid-run
- a script-generated Book Now click, which must be ignored
- the switches turned off and on
