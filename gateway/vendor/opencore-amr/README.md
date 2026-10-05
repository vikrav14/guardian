# AMR-NB codec

`amrnb.cjs` is `js/amrnb.js` from https://github.com/yxl/opencore-amr-js,
commit `dcf3d2b5f384a1d9ded2a54e4c137a81747b222b` (Apache-2.0).
The only local change is the appended `module.exports = AMR` adapter.
Retain LICENSE and NOTICE. Run only inside the bounded medication audio worker;
never on the TCP event loop. No audio leaves the gateway for encoding.
