import { MIXER_SHADER } from '../color/colorMixer';
export const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_uv;

out vec2 v_uv;

void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform sampler3D u_lut;
uniform sampler2D u_curves;
uniform bool u_curves_enabled;
uniform vec2 u_endpoints;
uniform float u_lut_size;
uniform vec2 u_resolution;

// Adjustments
uniform float u_exposure;        // -3.0 to +3.0
uniform float u_temperature;     // -1.0 to +1.0
uniform float u_tint;            // -1.0 to +1.0
uniform float u_highlights;      // -1.0 to +1.0
uniform float u_shadows;         // -1.0 to +1.0
uniform float u_contrast;        // -1.0 to +1.0
uniform float u_saturation;      // -1.0 to +1.0
uniform float u_grain;           // 0.0 to 1.0
uniform float u_sharpness;       // 0.0 to 1.0
uniform float u_vignette;        // 0.0 to 1.0
uniform float u_film_strength;   // 0.0 to 1.0

// Comparison
uniform int u_compare_mode;      // 0 = Normal, 1 = Original, 2 = Split
uniform float u_split_pos;       // 0.0 to 1.0
uniform sampler2D u_stamp;
uniform bool u_stamp_enabled;
uniform vec4 u_stamp_rect;
uniform vec3 u_optics;
uniform int u_optical_samples;
uniform float u_seed;

// sRGB <-> Linear Conversions (IEC 61966-2-1)
vec3 srgbToLinear(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 linearToSrgb(vec3 c) {
    c = max(vec3(0.0), c);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Pseudo-random noise for film grain
float hash(vec2 p, float s) {
    p = fract(p * vec2(123.34, 456.21) + s);
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec4 curveSample(float x) {
    float index = clamp(x, 0.0, 1.0) * 1023.0;
    int lo = int(floor(index));
    return mix(texelFetch(u_curves, ivec2(lo, 0), 0), texelFetch(u_curves, ivec2(min(lo+1,1023), 0), 0), fract(index));
}
vec3 applyCurves(vec3 c) {
    if (!u_curves_enabled) return c;
    vec3 w = vec3(curveSample(c.r).r, curveSample(c.g).r, curveSample(c.b).r);
    return vec3(curveSample(w.r).g, curveSample(w.g).b, curveSample(w.b).a);
}
${MIXER_SHADER}
vec3 grade(vec3 srgb) {

    // 1. Convert to Linear for physical optical adjustments
    vec3 lin = srgbToLinear(srgb);

    // 2. Exposure adjustment (linear multiply by 2^EV)
    lin *= pow(2.0, u_exposure);

    // 3. White Balance (Temperature and Tint in linear space)
    vec3 wb;
    wb.r = 1.0 + u_temperature * 0.25 + u_tint * 0.12;
    wb.g = 1.0 - u_tint * 0.20;
    wb.b = 1.0 - u_temperature * 0.25 + u_tint * 0.12;
    lin *= max(vec3(0.05), wb);

    // 4. Highlights and Shadows (in linear space)
    float lumLin = dot(lin, vec3(0.2126, 0.7152, 0.0722));

    // Shadows lift/compress (peaks around mid-shadows 0.05 - 0.2 linear)
    float shadowMask = clamp(1.0 - lumLin / 0.35, 0.0, 1.0);
    lin *= (1.0 + u_shadows * 0.6 * shadowMask);

    // Highlights compress/boost (peaks in high values > 0.4 linear)
    float highlightMask = clamp((lumLin - 0.25) / 0.75, 0.0, 1.0);
    lin *= (1.0 + u_highlights * 0.5 * highlightMask);

    // 5. Convert back to sRGB for tone & 3D LUT domain
    vec3 srgbGraded = linearToSrgb(lin);

    // 6. Contrast (centered at middle gray 0.5 in gamma space)
    if (abs(u_contrast) > 0.001) {
        float cFactor = 1.0 + u_contrast * 0.6;
        srgbGraded = (srgbGraded - 0.5) * cFactor + 0.5;
        srgbGraded = clamp(srgbGraded, 0.0, 1.0);
    }

    if (any(notEqual(u_endpoints, vec2(0.0)))) {
        vec3 t = clamp(srgbGraded, 0.0, 1.0);
        srgbGraded = clamp(srgbGraded + u_endpoints.x * 0.15 * pow(vec3(1.0)-t,vec3(4.0)) + u_endpoints.y * 0.15 * pow(t,vec3(4.0)), 0.0, 1.0);
    }
    // 7. Apply 3D LUT with half-texel offset for accurate lattice sampling
    vec3 lutCoord = (clamp(srgbGraded, 0.0, 1.0) * (u_lut_size - 1.0) + 0.5) / u_lut_size;
    vec3 lutSample = texture(u_lut, lutCoord).rgb;

    // 8. Film strength mix
    vec3 color = mix(srgbGraded, lutSample, u_film_strength);

    color = applyCurves(color);

    if (u_mixer_reference) return clamp(color,0.0,1.0);
    color = mixColors(color);

    // 9. Saturation
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(lum), color, max(0.0, 1.0 + u_saturation));

    return color;
}

void main() {
    // Check if in split original section
    bool showOriginal = (u_compare_mode == 1) || (u_compare_mode == 2 && v_uv.x < u_split_pos);

    // Draw split line if in split mode
    if (u_compare_mode == 2 && abs(v_uv.x - u_split_pos) * u_resolution.x < 1.5) {
        fragColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
    }

    vec4 rawColor = texture(u_image, v_uv);
    if (showOriginal) {
        fragColor = rawColor;
        return;
    }

    vec3 srgb = rawColor.rgb;
    vec3 color = grade(srgb);
    if (u_mixer_reference || u_mixer_visualize >= 0) { fragColor = vec4(clamp(color,0.0,1.0),rawColor.a); return; }
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    if (max(u_optics.x, max(u_optics.y, u_optics.z)) > 0.0) {
        float shortSide = min(u_resolution.x, u_resolution.y);
        vec2 radius = vec2(shortSide) / u_resolution * 0.004;
        vec3 soft = vec3(0.0);
        vec3 bright = vec3(0.0);
        float brightWeight = 0.0;
        for (int i = 0; i < 8; i++) {
            if (i >= u_optical_samples) break;
            float angle = float(i) * 6.2831853 / float(u_optical_samples);
            vec3 sampleColor = texture(u_image, clamp(v_uv + vec2(cos(angle), sin(angle)) * radius, vec2(0.0), vec2(1.0))).rgb;
            soft += sampleColor;
            float mask = smoothstep(0.60, 0.98, dot(sampleColor, vec3(0.2126,0.7152,0.0722)));
            bright += sampleColor * mask;
            brightWeight += mask;
        }
        // Grade accumulated neighborhoods once, avoiding a full tone/LUT pipeline per tap.
        soft = grade(soft / float(u_optical_samples));
        bright = brightWeight > 0.0 ? grade(bright / brightWeight) * (brightWeight / float(u_optical_samples)) : vec3(0.0);
        color = mix(color, soft, u_optics.z * 0.45);
        color += bright * u_optics.x * 0.28;
        color += dot(bright, vec3(0.2126,0.7152,0.0722)) * vec3(1.0,0.22,0.04) * u_optics.y * 0.18;
    }

    // 10. Sharpness (high-pass filter)
    if (u_sharpness > 0.01) {
        vec2 px = 1.0 / u_resolution;
        vec3 cN = texture(u_image, v_uv + vec2(0.0, -px.y)).rgb;
        vec3 cS = texture(u_image, v_uv + vec2(0.0,  px.y)).rgb;
        vec3 cW = texture(u_image, v_uv + vec2(-px.x, 0.0)).rgb;
        vec3 cE = texture(u_image, v_uv + vec2( px.x, 0.0)).rgb;
        vec3 laplacian = (cN + cS + cW + cE) * 0.25 - srgb;
        color -= laplacian * (u_sharpness * 1.2);
    }

    // 11. Film Grain (modulated by luminance: midtone emphasis, falloff in blacks/highlights)
    if (u_grain > 0.01) {
        float noise = hash(v_uv * u_resolution * 0.75, u_seed) - 0.5;
        float grainMask = 4.0 * lum * (1.0 - lum); // Parabolic peak at midtone 0.5
        color += noise * (u_grain * 0.16) * grainMask;
    }

    // 12. Vignette
    if (u_vignette > 0.01) {
        vec2 coord = (v_uv - 0.5) * vec2(u_resolution.x / min(u_resolution.x, u_resolution.y), 1.0);
        float dist = length(coord);
        float vigFactor = smoothstep(0.85, 0.35, dist);
        color = mix(color * (vigFactor + (1.0 - vigFactor) * (1.0 - u_vignette * 0.8)), color, 1.0 - u_vignette);
    }

    float alpha = rawColor.a;
    if (u_stamp_enabled) {
        vec2 stampUV = (v_uv * u_resolution - u_stamp_rect.xy) / u_stamp_rect.zw;
        if (all(greaterThanEqual(stampUV,vec2(0.0))) && all(lessThanEqual(stampUV,vec2(1.0)))) {
            vec4 stamp = texture(u_stamp, stampUV);
            color = mix(clamp(color,0.0,1.0),stamp.rgb,stamp.a);
            alpha = stamp.a + alpha * (1.0 - stamp.a);
        }
    }
    fragColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
`;
