# Raw hardware and protocol references

This directory contains unmodified vendor material collected during hardware
evaluation. Guardian's sole production model is **ReachFar V52**. Older-family
documents are historical inputs only: they must not override V52 packet
captures, real-device acceptance, or the V52-only decoder tests.

| File | Description |
|------|-------------|
| [V28C-DataSheet.pdf](V28C-DataSheet.pdf) | Historical evaluation datasheet; not a production V52 authority |
| [Switch-Server-SMS-Commands.pdf](Switch-Server-SMS-Commands.pdf) | Generic provisioning commands; use only forms confirmed on the real V52 |
| V28C Communication Protocol.pdf | Historical mixed-family ASCII reference; never use its alarm bits for V52 |
| V28C Communication Example.pdf | Historical worked examples; not V52 acceptance evidence |
| Setting APN.pdf | ReachFar email — `pw,123456,ts#` and `pw,123456,apn,...` format |

The three protocol/APN PDFs may live outside the repo (vendor email / download). Copy them here when available.

**Current release evidence:** [../GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md](../GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md)

Preserve raw vendor files, but record interpretation separately. For V52,
prefer live captures plus explicit regression tests over conflicting generic
or older-model prose.
