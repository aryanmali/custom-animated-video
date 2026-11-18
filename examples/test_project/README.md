# Example: "Every lamp back home" (7 s)

Script: `script.txt` · director plan: `storyboard.json` (3 shots, crossfades, 11 frame-accurate SFX events) ·
art: `scene_drawers.js` (ghat at dusk, walking figure with IK feet and cloth chains, lip-synced close-up bust,
low-angle hero shot).

These drawers are bespoke art written against a specific style bible, so the style you pass must provide:

* mood **`diya_dusk`** (warm low key light from the left works best, e.g. `key_dir_deg` ≈ 200)
* palette names: `brick` `cool_teal_shadow` `cream_cloth` `diya_core` `diya_flame` `dusk_mauve_shadow` `flame_orange`
  `gold` `gold_deep` `gold_glow` `hair` `indigo` `jasmine` `marigold` `plum_shadow` `saffron` `sandstone`
  `sandstone_dark` `skin_mid` `teal_stone` `terracotta` `umber_shadow` `vermilion` `water_teal`

Record (or synthesize) a voiceover of `script.txt`, then:

```bash
python3 ../../scripts/build_video.py --script script.txt --audio voiceover.wav --style your_style_bible.json \
        --storyboard storyboard.json --drawers scene_drawers.js --out out/final_video.mp4
```

With any other style, use the generic drawers instead: drop `--storyboard/--drawers` and add `--auto`.
