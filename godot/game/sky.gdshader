// The pixel sky: a vertical gradient in flat bands, Bayer-dithered where bands meet, with a
// warm horizon at dawn and dusk and twinkling stars at night. Everything is computed per art
// pixel (screen pixels / zoom), so the dither and the stars are the same chunky pixels as
// the tower.
shader_type canvas_item;

uniform vec4 top_color : source_color = vec4(0.37, 0.66, 1.0, 1.0);
uniform vec4 bottom_color : source_color = vec4(0.85, 0.93, 1.0, 1.0);
uniform vec4 horizon_color : source_color = vec4(1.0, 0.69, 0.44, 1.0);
uniform float dusk = 0.0;          // 0..1, peaks at the day-night transition
uniform float night = 0.0;         // 0 day .. 1 night
uniform float zoom = 2.0;          // screen pixels per art pixel
uniform float ground = 600.0;      // the ground line, in screen pixels from the top
uniform vec2 rect_size = vec2(360.0, 740.0);
uniform vec2 star_offset = vec2(0.0);   // art pixels, a slow parallax for the stars
uniform float bands = 14.0;

float bayer4(vec2 p) {
	int x = int(mod(p.x, 4.0));
	int y = int(mod(p.y, 4.0));
	int m[16] = int[](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
	return float(m[y * 4 + x]) / 16.0;
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void fragment() {
	vec2 px = floor(UV * rect_size / zoom);           // the art pixel under this fragment
	float g = max(1.0, ground / zoom);
	float t = clamp(px.y / g, 0.0, 1.0);
	// Banded: snap t to `bands` steps, with a 4x4 ordered dither between neighbouring bands.
	float tb = floor(t * bands + bayer4(px)) / bands;
	vec3 col = mix(top_color.rgb, bottom_color.rgb, clamp(tb / 0.65, 0.0, 1.0));
	if (tb > 0.65) {
		col = mix(col, horizon_color.rgb, (tb - 0.65) / 0.35 * dusk * 0.75);
	}
	// Stars: a few art pixels out of a thousand, above the lower third, twinkling.
	if (night > 0.3) {
		vec2 sp = px + floor(star_offset);
		float h = hash(sp);
		if (h > 0.9965 && t < 0.62) {
			float tw = 0.55 + 0.45 * sin(TIME * (1.5 + fract(h * 91.0) * 2.5) + h * 40.0);
			col = mix(col, vec3(1.0, 0.98, 0.9), clamp((night - 0.3) * 1.6, 0.0, 1.0) * tw);
		}
	}
	COLOR = vec4(col, 1.0);
}
