# Hardware & protocol reference

Source PDFs for the Guardian GPS pendant (V28C family).

| File | Description |
|------|-------------|
| [V28C-DataSheet.pdf](V28C-DataSheet.pdf) | Device datasheet — specs, sensors, battery, interfaces |
| [Switch-Server-SMS-Commands.pdf](Switch-Server-SMS-Commands.pdf) | SMS commands: center, ip, apn, sos, ts#, imei |
| V28C Communication Protocol.pdf | ASCII protocol spec — LK, UD_LTE, AL_LTE, server commands |
| V28C Communication Example.pdf | Worked examples of device ↔ server frames |
| Setting APN.pdf | ReachFar email — `pw,123456,ts#` and `pw,123456,apn,...` format |

The three protocol/APN PDFs may live outside the repo (vendor email / download). Copy them here when available.

**Setup walkthrough:** [../V28C_DEVICE_SETUP.md](../V28C_DEVICE_SETUP.md)

These are vendor documents. Prefer them over assumptions when implementing GPRS/SMS command downlink or validating protocol behaviour.
