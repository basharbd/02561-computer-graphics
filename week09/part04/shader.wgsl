struct Uniforms {
    mvp: mat4x4f,
    model: mat4x4f,
    lightViewProj: mat4x4f,
    eye: vec3f,
    visibility: f32,
    light_pos: vec3f,
    L_e: f32,
    L_a: f32,
    k_d: f32,
    k_s: f32,
    s: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_2d<f32>;
@group(0) @binding(3) var shadowTexture: texture_2d<f32>;

// ----------------------------------------------------------
// Ground
// ----------------------------------------------------------
struct VSOutGround {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
    @location(1) inPos: vec4f,
}

@vertex
fn main_vs_ground(@location(0) inPos: vec4f, @location(3) texCoord: vec2f) -> VSOutGround {
    var out: VSOutGround;
    out.position = uniforms.mvp * inPos;
    out.texCoord = texCoord;
    out.inPos = inPos;
    return out;
}

@fragment
fn main_fs_ground(@location(0) texCoords: vec2f, @location(1) inPos: vec4f) -> @location(0) vec4f {
    let p_clip_l = uniforms.lightViewProj * inPos;
    let shadowCoords = (p_clip_l.xyz / p_clip_l.w) * vec3f(0.5, -0.5, 1.0) + vec3f(0.5, 0.5, 0.0);

    let z_light = shadowCoords.z;
    let depth = textureLoad(shadowTexture, vec2u(shadowCoords.xy * vec2f(2048, 2048)), 0);

    let bias = 0.005;
    let visibility = select(1.0, 0.4, depth.r < z_light - bias);

    let texColor = textureSample(ourTexture, ourSampler, texCoords);
    return vec4f(texColor.rgb * visibility, texColor.a);
}

// ----------------------------------------------------------
// Teapot
// ----------------------------------------------------------
struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f,
}

@vertex
fn main_vs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> VSOut {
    var out: VSOut;
    out.position = uniforms.mvp * inPos;
    out.inPos = inPos;
    out.color = color;
    out.normal = normal;
    return out;
}

@fragment
fn main_fs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> @location(0) vec4f {
    let n = normalize(normal.xyz);

    let p_clip_l = uniforms.lightViewProj * uniforms.model * inPos;
    let shadowCoords = (p_clip_l.xyz / p_clip_l.w) * vec3f(0.5, -0.5, 1.0) + vec3f(0.5, 0.5, 0.0);
    let z_light = shadowCoords.z;
    let depth = textureLoad(shadowTexture, vec2u(shadowCoords.xy * vec2f(2048, 2048)), 0);

    let bias = 0.005;
    let visibility = select(1.0, 0.4, depth.r < z_light - bias);

    let k_d = vec3f(1) * uniforms.k_d;
    let k_a = k_d;
    let k_s = vec3f(1, 1, 1) * uniforms.k_s;

    let l_e = -normalize(uniforms.light_pos - (uniforms.model * inPos).xyz);
    let omega_i = -l_e;

    let L_e = vec3f(1, 1, 1) * uniforms.L_e;
    let L_i = L_e;
    let L_a = vec3f(1, 1, 1) * uniforms.L_a;

    let w_o = normalize(uniforms.eye - inPos.xyz);
    let w_r = 2 * dot(omega_i, n) * n - omega_i;

    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);
    let L_rd = k_d * L_e * max(dot(n, omega_i), 0.0);
    let L_ra = k_a * L_a;

    let L_P_rs_select = select(vec3f(0, 0, 0), L_P_rs, dot(n, omega_i) > 0.0);

    let L_o = (L_rd + L_P_rs_select) * visibility + L_ra;
    return vec4f(L_o, 1.0);
}

// ----------------------------------------------------------
// Shadow depth pass
// ----------------------------------------------------------
@vertex
fn main_vs_depth(@location(0) inPos: vec4f) -> @builtin(position) vec4f {
    return uniforms.lightViewProj * uniforms.model * inPos;
}

@fragment
fn main_fs_depth(@builtin(position) fragcoord: vec4f) -> @location(0) vec4f {
    return vec4f(vec3f(fragcoord.z), 1.0);
}
