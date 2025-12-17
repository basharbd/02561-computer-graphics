struct Uniforms {
    eye: vec3f,
    L_e: f32,
    L_a: f32,
    k_d: f32,
    k_s: f32,
    s: f32,
    // Align to 16 bytes: 3+1+1+1+1+1 = 8 floats = 32 bytes (OK)
    mvp: mat4x4f,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f,
}

@vertex
fn main_vs(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f, @builtin(instance_index) instance: u32) -> VSOut {
    var vsOut: VSOut;
    vsOut.position = uniforms.mvp * inPos;
    vsOut.inPos = inPos;
    vsOut.color = color;
    vsOut.normal = normal;
    return vsOut;
}

@fragment
fn main_fs(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> @location(0) vec4f {
    let n = normalize(normal.xyz);

    let k_d = color.xyz * uniforms.k_d;
    let k_a = k_d;
    let k_s = vec3f(1, 1, 1) * uniforms.k_s;

    // Light direction (Fixed light)
    const l_e = vec3f(0, 0, - 1);
    const omega_i = - l_e;
    let L_e = vec3f(1, 1, 1) * uniforms.L_e;
    let L_i = L_e;
    let L_a = vec3f(1, 1, 1) * uniforms.L_a;

    // Phong reflection model
    // eye comes from uniforms, updated by JS controls
    let w_o = normalize(uniforms.eye - inPos.xyz);
    let w_r = 2 * dot(omega_i, n) * n - omega_i;

    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);

    let L_rd = k_d * L_e * max(dot(n, omega_i), 0.0);
    let L_ra = k_a * L_a;

    let L_P_rs_select = select(vec3f(0, 0, 0), L_P_rs, dot(n, omega_i) > 0.0);

    let L_o = L_rd + L_ra + L_P_rs_select;
    return vec4f(L_o, 1.0);
}