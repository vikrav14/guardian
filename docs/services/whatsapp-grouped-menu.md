# Grouped WhatsApp menu

Implemented on a separate draft branch on 24 September 2026. Live WhatsApp
acceptance is pending. This is stacked on `feat/v52-watch-modes` to preserve the
current watch functionality; PR #115 stays draft with its dynamic call-template
rollout paused for Meta approval. Do not merge or enable that rollout as part of
menu testing.

## What the family sees

Send **Hi**, **Menu** or **Help** to Guardian. If the caller has several linked
watches, Guardian first shows a **Choose wearer** list. Then:

> Hi, I’m Guardian. What would you like to check for Alex?
>
> Choose an option below, or type your question.
>
> **Choose an option**

The button opens one native WhatsApp list, with these sections:

| Section | Option | Response |
| --- | --- | --- |
| Check now | Location | Existing location reader, source, freshness and uncertainty; map link when supported by evidence |
| Check now | Watch status | Latest battery reading and connection report |
| Check now | Weather nearby | Existing weather reader using the wearer’s recorded location |
| Activity & wellbeing | Steps & activity | Today’s displayable activity records |
| Activity & wellbeing | Journeys | Three recent confirmed journeys |
| Activity & wellbeing | Wellbeing readings | Saved displayable readings under current wearer consent |
| Activity & wellbeing | Today’s summary | Care only: today’s recorded journeys, alerts and watch status |
| Safety & care | Recent alerts | Five recent recorded alerts, times in Mauritius time |
| Safety & care | Safe zones | Saved active boundaries; not a claim of current presence |
| Safety & care | Reminders | Saved enabled medication reminders; not proof medication was taken |

Family has nine options when both hardware-reading features are customer-enabled;
Care adds the tenth, Today’s summary. The existing activity/wellbeing rollout flags
and plan features still apply: disabled options are omitted, not newly enabled.
Wellbeing selection checks the existing live consent reader before exposing data.
Missing consent gives instructions to review it in the app.

Location answers offer **Watch status**, **Weather nearby** and **Main menu** for
a single wearer. Other responses offer a relevant next action and Main menu.
For multiple wearers, **Change wearer** replaces the second contextual action.
**Switch wearer** also works as typed text. Lists of more than eight wearers use
Previous/More pages within the ten-row limit; watch suffixes distinguish duplicate
display names. Every answer remains bound to the chosen watch.

Long answers use **More** rather than truncating evidence or dropping qualifiers.
Each page re-reads with current permissions and consent; the records can therefore
change between pages. The first version remains English, matching the current
assistant, and uses Mauritius time for alerts and daily summaries.

## Actions and access

- Taps use random opaque IDs bound to sender, account, exact linked IMEI and a
  fixed action. Titles are never passed into a model or confirmation parser.
- The webhook verifies the existing Meta signature/phone-number boundary and
  deduplicates by `wamid`. Caller context and subscription are loaded again for
  every selection. A menu cannot preserve revoked access.
- Emergency-contact membership is notification-only. It does not grant this
  menu access to the owner’s watch information.
- No menu selection sends watch commands, changes call answering, triggers an
  SOS, or edits data. **Add reminder** gives a typed example; the established
  reminder flow still requires explicit confirmation before saving.
- Safe zones and reminders use bounded exact-IMEI queries, with a visible
  limited-results notice when the read reaches its cap. Edit them in the app.
- Text questions and YES/CANCEL continue through the established chat/action
  routes. Selecting a wearer also seeds the existing short-lived conversation
  wearer selection for subsequent typed questions.
- Menu tokens live only in gateway memory for 30 minutes, capped at 10,000.
  Old, unknown, cross-account, or post-restart selections open a fresh menu and
  perform no action. Multiple gateway processes may refresh each other’s menus;
  shared signed/stateful tokens are a future scaling task.
- These are replies to user-initiated conversations, not new outbound alert
  templates. They use the existing Meta session-message route. No new template
  submission is part of this change, and the pending SOS/fall v2 templates and
  their default-off rollout flags remain unchanged.

Meta contracts: [interactive lists](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages/),
[reply buttons](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages/)
and [interactive webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/interactive/).
Payloads enforce ten total list rows, three reply buttons and the relevant text
limits. Menu interactions are deterministic and do not invoke an LLM.

## Local acceptance on Windows

Keep ngrok running with the existing HTTPS webhook mapped to port 9001. No watch
SMS, tunnel change, Flutter rebuild, Firestore migration or new secret is needed.
Stop the running gateway with Ctrl+C. In PowerShell:

```powershell
cd C:\Users\MSI\repos\guardian
git status --short
git fetch origin
git switch feat/whatsapp-grouped-menu
git pull --ff-only origin feat/whatsapp-grouped-menu
cd gateway
npm start
```

If Git reports tracked local changes, preserve them before switching; never
discard unrelated work. On first checkout, `git switch` tracks the fetched branch.

1. Send **Hi** to Guardian from the registered family number. Confirm **Choose an
   option** opens grouped rows with the correct wearer and plan.
2. Tap Location, then Watch status, then Main menu. Compare location source/age
   and battery with the app. Try Weather nearby and Journeys.
3. Try Recent alerts, Safe zones and Reminders. Check that only the chosen
   wearer’s records appear and saved settings are not described as live proof.
4. If enabled and consented, try Steps & activity and Wellbeing readings. On
   Care, try Today’s summary. Confirm unavailable features are not advertised.
5. With two linked watches, choose each wearer and confirm the answers follow
   the selection. Check Change wearer. Continue with a typed question as well.
6. Restart the gateway, then tap an old menu: it should refresh safely. A new
   menu must work. Notification-only contacts must receive the access boundary.

Record real results before marking the PR ready. Tests use synthetic callers,
records and HTTP transport; no live WhatsApp messages or watch commands are sent.

Rollback: stop the gateway, switch back to `feat/v52-watch-modes`, and restart.
No stored configuration has been migrated by this menu change.

## Verification and handoff

- Full gateway suite: 1,408 tests passed after the initial implementation.
- Additional signed-webhook regression: passed (signature rejection, titleless
  selection dispatch, native interactive response, duplicate suppression).
- Targeted tests also cover Meta limits, multi-wearer selection/pagination,
  foreign/expired IDs, changed access/plan/feature flags, consent-required reads,
  long answers and existing confirmation routing.
- Live WhatsApp rendering and tap-through: pending operator test above.
- Wiki publication is unavailable through the current repository connector;
  use this page as the QA handoff until the corresponding wiki entry can be
  published. Repository instructions and assistant docs link here.
