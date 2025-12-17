struct Uniforms {
    mvp: mat4x4f,
    model: mat4x4f,
    eye: vec3f,
    visibility: f32,
    light_pos: vec3f,
    L_e: f32,
    L_a: f32,
    k_d: f32,
    k_s: f32,
    s: f32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;
@group(0) @binding(1)
var ourSampler: sampler;
@group(0) @binding(2)
var ourTexture: texture_2d<f32>;

// GROUND
struct VSOutGround {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
}

@vertex
fn main_vs_ground(@location(0) inPos: vec4f, @location(3) texCoord: vec2f, @builtin(instance_index) instance: u32) -> VSOutGround {
    var vsOut: VSOutGround;
    vsOut.position = uniforms.mvp * inPos;
    vsOut.texCoord = texCoord;
    return vsOut;
}

@fragment
fn main_fs_ground(@location(0) texCoords: vec2f) -> @location(0) vec4f {
    return textureSample(ourTexture, ourSampler, texCoords) * vec4f(uniforms.visibility, uniforms.visibility, uniforms.visibility, 1.0);
}

// TEAPOT
struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f,
}

@vertex
fn main_vs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f, @builtin(instance_index) instance: u32) -> VSOut {
    var vsOut: VSOut;
    vsOut.position = uniforms.mvp * inPos;
    vsOut.inPos = inPos;
    vsOut.color = color;
    vsOut.normal = normal;
    return vsOut;
}

@fragment
fn main_fs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> @location(0) vec4f {
    let n = normalize(normal.xyz);

    // Fixed diffuse and specular color
    let k_d = vec3f(1) * uniforms.k_d;
    let k_a = k_d;
    let k_s = vec3f(1, 1, 1) * uniforms.k_s;

    // Light direction
    let l_e = -normalize(uniforms.light_pos - (uniforms.model * inPos).xyz);
    let omega_i = -l_e;
    let L_e = vec3f(1, 1, 1) * uniforms.L_e;
    let L_i = L_e;
    let L_a = vec3f(1, 1, 1) * uniforms.L_a;

    // Phong reflection model
    let w_o = normalize(uniforms.eye - inPos.xyz);
    let w_r = 2 * dot(omega_i, n) * n - omega_i;

    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);

    let L_rd = k_d * L_e * max(dot(n, omega_i), 0.0);
    let L_ra = k_a * L_a;

    // Modified Phong: avoid specular highlights on the back side. Only show when normal and light angle < 90 deg
    let L_P_rs_select = select(vec3f(0, 0, 0), L_P_rs, dot(n, omega_i) > 0.0);

    let L_o = L_rd + L_ra + L_P_rs_select;
    return vec4f(L_o, 1.0);
}