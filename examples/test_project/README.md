# Example: "Every lamp back home" (7 s)

Script: `script.txt` · plan: `storyboard.json` (3 shots, crossfades, `sound_intent` + 11 frame-accurate SFX events) ·
specs: `visual_specs/` (`_common.md` + one per scene: the storyboarder → artist contract) ·
art: `drawers/` (`_common.js` = ghat world + walking figure rig with IK feet and cloth chains; `ghat_dusk.js` = wide and
low-angle hero shots; `ghat_closeup.js` = lip-synced close-up bust). One scene per file: editing `ghat_closeup.js` re-renders
only `s2_closeup` (and its crossfade follower `s3_hero`).

These drawers are bespoke art written against a specific style bible, so the style you pass must provide:

* mood **`diya_dusk`** (warm low key light from the left works best, e.g. `key_dir_deg` ≈ 200)
* palette names: `brick` `cool_teal_shadow` `cream_cloth` `diya_core` `diya_flame` `dusk_mauve_shadow` `flame_orange`
  `gold` `gold_deep` `gold_glow` `hair` `indigo` `jasmine` `marigold` `plum_shadow` `saffron` `sandstone`
  `sandstone_dark` `skin_mid` `teal_stone` `terracotta` `umber_shadow` `vermilion` `water_teal`

Record (or synthesize) a voiceover of `script.txt`, then:

```bash
python3 ../../scripts/build_video.py --script script.txt --audio voiceover.wav --style your_style_bible.json \
        --storyboard storyboard.json --drawers drawers --out out/final_video.mp4
```

With any other style, use the generic drawers instead: drop `--storyboard/--drawers` and add `--auto`.
