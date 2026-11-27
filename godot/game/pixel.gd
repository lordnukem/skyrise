# The pixel art: the sprite atlas and the pixel font, both made by tools/pixelart/build.py.
# One texture holds every sprite, so the tower draws in a few batches. The font is built at
# runtime as a bitmap FontFile from font.png; it scales by whole numbers only (9 px is 1x,
# 18 px is 2x), so text stays on the pixel grid.
extends RefCounted

const ATLAS_PNG := "res://assets/pixel/atlas.png"
const ATLAS_JSON := "res://assets/pixel/atlas.json"
const FONT_PNG := "res://assets/pixel/font.png"
const FONT_JSON := "res://assets/pixel/font.json"
const FONT_1X := 9                       # the font's line height at 1x

static var _texture: Texture2D
static var _rects := {}
static var _font: FontFile
static var _ui2x: ImageTexture
static var _ui2x_rects := {}


static func texture() -> Texture2D:
	if _texture == null:
		_texture = load(ATLAS_PNG)
		var d = JSON.parse_string(FileAccess.get_file_as_string(ATLAS_JSON))
		for k in d:
			var r: Array = d[k]
			_rects[k] = Rect2(r[0], r[1], r[2], r[3])
	return _texture


static func has(name: String) -> bool:
	texture()
	return _rects.has(name)


static func rect(name: String) -> Rect2:
	texture()
	return _rects.get(name, Rect2())


## The pixel font as a FontFile: one 9 px bitmap size, scaled by integers only.
static func font() -> FontFile:
	if _font != null:
		return _font
	var meta = JSON.parse_string(FileAccess.get_file_as_string(FONT_JSON))
	var img: Image = (load(FONT_PNG) as Texture2D).get_image()
	if img.is_compressed():
		img.decompress()
	var f := FontFile.new()
	var h: int = meta.height
	var size := Vector2i(h, 0)
	f.fixed_size = h
	f.fixed_size_scale_mode = TextServer.FIXED_SIZE_SCALE_INTEGER_ONLY
	f.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	f.generate_mipmaps = false
	f.set_texture_image(0, size, 0, img)
	f.set_cache_ascent(0, h, meta.ascent)
	f.set_cache_descent(0, h, h - meta.ascent)
	for ch in meta.glyphs:
		var g: Array = meta.glyphs[ch]
		var code: int = ch.unicode_at(0)
		f.set_glyph_advance(0, h, code, Vector2(g[3], 0))
		f.set_glyph_offset(0, size, code, Vector2(0, -meta.ascent))
		f.set_glyph_size(0, size, code, Vector2(g[2], h))
		f.set_glyph_uv_rect(0, size, code, Rect2(g[0], g[1], g[2], h))
		f.set_glyph_texture_idx(0, size, code, 0)
	_font = f
	return f


## UI pieces (panels, buttons, icons, stars) at 2x, for StyleBoxTextures and the toolbar:
## a texture of its own so nine-patch margins work in 2x pixels.
static func ui2x() -> ImageTexture:
	if _ui2x != null:
		return _ui2x
	var src: Image = texture().get_image()
	if src.is_compressed():
		src.decompress()
	var names := []
	for k in _rects:
		if k.begins_with("ui.") or k.begins_with("icon."):
			names.append(k)
	names.sort()
	var cols := 8
	var cell := 26
	var out := Image.create(cols * cell, ceili(names.size() / float(cols)) * cell, false, Image.FORMAT_RGBA8)
	for i in names.size():
		var r: Rect2 = _rects[names[i]]
		var part := src.get_region(Rect2i(r))
		part.resize(int(r.size.x) * 2, int(r.size.y) * 2, Image.INTERPOLATE_NEAREST)
		var at := Vector2i((i % cols) * cell, (i / cols) * cell)
		out.blit_rect(part, Rect2i(Vector2i.ZERO, part.get_size()), at)
		_ui2x_rects[names[i]] = Rect2(at, part.get_size())
	_ui2x = ImageTexture.create_from_image(out)
	return _ui2x


static func ui_rect(name: String) -> Rect2:
	ui2x()
	return _ui2x_rects.get(name, Rect2())


## A nine-patch StyleBox from a 2x UI piece (border 3 art px = 6 px).
static func stylebox(name: String, pad: int = 8) -> StyleBoxTexture:
	var s := StyleBoxTexture.new()
	s.texture = ui2x()
	s.region_rect = ui_rect(name)
	for side in [SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM]:
		s.set_texture_margin(side, 6)
		s.set_content_margin(side, pad)
	s.axis_stretch_horizontal = StyleBoxTexture.AXIS_STRETCH_MODE_STRETCH
	s.axis_stretch_vertical = StyleBoxTexture.AXIS_STRETCH_MODE_STRETCH
	return s
