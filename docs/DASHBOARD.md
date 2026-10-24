# Dashboards: what goes where

The admin has three summary surfaces: **Översikt** (start page), **Statistik**
and the stat rows on **Beställningar** and **Catering**. Their order follows the
questions a restaurant owner or staff member asks, in the order they ask them.
Put a new figure where its question belongs, not where there is room.

## Översikt: "how is today going, and what needs me now?"

1. **Today, right now** (the stat row, always first, 2 x 2 on a phone):
   - *Att hantera*: everything waiting on a person, most urgent first:
     kitchen tickets that did not print (failed jobs, or queued jobs while the
     printer is offline: `GET /print/status`), failed card charges, catering
     requests awaiting an answer, unconfirmed bookings. It turns red
     (`stat-tile--attention`) only when something waits.
   - *Bokningar idag*: bookings, covers (guests) and the next arrival.
   - *Aktiva beställningar*: new, cooking and ready (ordering plans only).
   - *Dagens omsättning*: paid orders today against the same weekday last week
     up to the same clock time (green or red by `shared/trend.ts`). Last in the
     row: money matters, but it cannot be acted on mid-service.
   Without ordering in the plan the row has two tiles (`--stat-cols`) instead
   of two tiles saying "ingår inte".
2. **Kom igång** (owner, only while steps remain, listing only those steps).
   Below the stat row so a restaurant that is live is never pushed down by
   setup; the finished list collapses to the bottom.
3. **Dagens bokningar**: the list behind the bookings tile.
4. **Den här månaden** (owner): revenue, bookings, guests and no-shows for the
   month so far against the same number of days before.
5. **Genvägar**.

Staff see the same operational order; the month card and Statistik amounts
are owner-only (the insights API returns `money: false` for staff).

## Statistik: "how did the period go, and why?"

- **Så gick det**: owner order is Omsättning, Bokningar, Gäster, Snittorder,
  Uteblivna, Beläggning (revenue first, then volume, spend, losses). Staff
  order is Gäster, Bokningar, Beläggning, Uteblivna, Beställningar,
  Tillagningstid (no amounts).
- **Att göra**: the generated suggestions, before the charts.
- **Varför**: for owners the revenue-per-day chart comes first (Omsättning),
  then guests and bookings, occupancy, orders and menu, catering, website.

## Beställningar and Catering

Their stat rows already lead with what waits (Nya / Väntar på dig, red when
non-zero), then the work in progress, then money. Keep that order.

## Rules for new figures

- A new "needs action" item goes into `todoQueue` (`features/oversikt/overview.ts`)
  in urgency order, not into a new tile.
- Every number gets a comparison where one exists, coloured by `shared/trend.ts`;
  never colour without the text change beside it.
- Count-up and the liquid fill come from `StatTile`/`Num`; they play once per
  login (`MotionScope`).

## Proposals (data not in the API today)

- **Covers per hour today** (kitchen pacing): needs reservations grouped by
  start hour for today; the list has the data but no forecast of walk-ins.
- **Today's revenue including card-terminal and Kassa sales**: Översikt
  counts online orders only; terminal and till sales are in insights
  (`inPersonRevenue`) per day, not per hour.
- **Tables free right now**: needs live table state (occupied/free) from the
  bookings service.
- **Unanswered guest messages / reviews**: no API.
