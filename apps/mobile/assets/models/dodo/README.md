# Guardian Dodo 3D stage test

This folder contains a single Meshy-generated Guardian Dodo character and
presentation clips derived from the same auto-rig.

## Meshy provenance

- Image-to-3D task: `019f9658-6238-752c-a4b6-d2f1e01c827d`
- Rigging task: `019f965c-e9f5-7c56-ad7d-11e1ca539e30`
- Source model: `guardian_dodo_rigged.glb`

## Dashboard clips

| Guardian state | Meshy preset | Asset |
| --- | --- | --- |
| Calm idle | Idle | `guardian_dodo_idle.glb` |
| Pendant listening | Listening Gesture | `guardian_dodo_pendant_listen.glb` |
| AI check | Checkout Gesture | `guardian_dodo_ai_check.glb` |
| WhatsApp update | Phone Call Gesture | `guardian_dodo_whatsapp_update.glb` |
| Family informed | Agree Gesture | `guardian_dodo_family_confirm.glb` |
| Linking/searching | Alert | `guardian_dodo_linking_search.glb` |

The GLBs are optimized for the 250px dashboard stage with Draco geometry,
1024px WebP textures, and lossless animation resampling. The unanimated rig is
kept as a source artifact but is not packaged by Flutter.
