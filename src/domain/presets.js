'use strict';

const PRESETS = Object.freeze([
  ['ghibli-dream', 'Ghibli Dream', 'Whimsical hand-painted fantasy anime portrait, lush botanical world, delicate watercolor texture, warm magical light'],
  ['anime-glow', 'Anime Glow', 'Vibrant modern anime portrait, luminous sunset sky, expressive eyes, crisp painterly detail and radiant color'],
  ['clay-charm', 'Clay Charm', 'Handcrafted claymation portrait, tactile polymer textures, miniature floral wardrobe, warm stop-motion studio light'],
  ['storybook-3d', 'Storybook 3D', 'Polished cinematic 3D storybook character, soft dimensional features, ornate wardrobe, warm animated-film lighting'],
  ['comic-pop', 'Comic Pop', 'Bold pop-art comic portrait, ink outlines, halftone dots, saturated primary colors, graphic panel energy'],
  ['cyber-neon', 'Cyber Neon', 'Neon cyberpunk portrait, electric magenta and cyan city lights, glossy futuristic styling, dramatic night atmosphere'],
  ['old-money', 'Old Money', 'Understated old-money luxury portrait, cream boucle styling, pearls, warm hotel light, refined editorial finish'],
  ['pastel-cinema', 'Pastel Cinema', 'Symmetrical pastel cinematic portrait, powder blue and blush palette, elegant styling, soft composed lighting'],
  ['flash-editorial', 'Flash Editorial', 'High-fashion direct-flash portrait, crisp contrast, monochrome styling, candid magazine attitude'],
  ['instant-memory', 'Instant Memory', 'Nostalgic instant-film portrait, faded warm color, soft grain, gentle imperfections, intimate analog mood'],
  ['y2k-digicam', 'Y2K Digicam', 'Early-2000s compact-camera portrait, hard flash, candid crop, cool digital color and nostalgic texture'],
  ['k-drama', 'K-Drama Soft', 'Luminous romantic drama still, airy pastel styling, soft bloom, flattering daylight and dreamy cinematic depth'],
  ['jewel-cinema', 'Jewel Cinema', 'Lavish jewel-toned musical-cinema portrait, ornate emerald and gold wardrobe, glowing festive lights, rich color'],
  ['fantasy-royal', 'Fantasy Royal', 'Enchanted royal fantasy portrait, crystalline crown, moonlit blue couture, magical sparkle and cinematic atmosphere'],
  ['dark-academia', 'Dark Academia', 'Moody dark-academia painted portrait, antique library atmosphere, burgundy velvet, old-master light and texture'],
  ['coquette-pink', 'Coquette Pink', 'Viral coquette portrait, pink ribbons and lace, rosy soft flash, playful romantic styling, polished social aesthetic'],
  ['neo-noir', 'Neo Noir', 'High-contrast neo-noir portrait, black wardrobe, sharp red rim light, deep shadow and tense cinematic mood'],
  ['bloom-surreal', 'Bloom Surreal', 'Surreal floral double-exposure portrait, layered translucent blossoms, dreamy fine-art composition, luminous color'],
  ['liquid-chrome', 'Liquid Chrome', 'Liquid-chrome futuristic fashion portrait, sculptural silver styling, cool specular light, premium sci-fi editorial'],
  ['vintage-oil', 'Vintage Oil', 'Classical vintage oil-painted portrait, aged canvas texture, warm museum palette, graceful old-world light'],
].map(([id, name, prompt], index) => ({ id, name, prompt, order: index + 1 })));

function getPreset(id) {
  return PRESETS.find((preset) => preset.id === id) || null;
}

module.exports = { PRESETS, getPreset };
