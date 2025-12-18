struct Uniforms {
    // Camera position (world/object space)
    eye: vec3f,

    // Phong parameters (scalars)
    L_e: f32,   // emitted radiance (white light intensity)
    L_a: f32,   // ambient radiance (white ambient intensity)
    k_d: f32,   // diffuse strength
    k_s: f32,   // specular strength
    s: f32,     // shininess exponent

    // Transform
    mvp: mat4x4f,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) inPos: vec4f, // object-space position
};

@vertex
fn main_vs(@location(0) inPos: vec4f, @builtin(instance_index) instance: u32) -> VSOut {
    var out: VSOut;
    out.position = uniforms.mvp * inPos;
    out.inPos = inPos;
    return out;
}

@fragment
fn main_fs(@location(0) inPos: vec4f) -> @location(0) vec4f {
    // Unit-sphere normal
    let n = normalize(inPos.xyz);

    // Material (fixed base colors)
    let kd = vec3f(1.0, 0.0, 0.0) * uniforms.k_d;
    let ka = kd;
    let ks = vec3f(1.0, 1.0, 1.0) * uniforms.k_s;

    // Directional light: l_e points where light goes; omega_i is incoming direction
    let omega_i = vec3f(0.0, 0.0, 1.0);

    let Le = vec3f(1.0) * uniforms.L_e;
    let La = vec3f(1.0) * uniforms.L_a;

    // View direction
    let w_o = normalize(uniforms.eye - inPos.xyz);

    // Reflection direction
    let w_r = 2.0 * dot(omega_i, n) * n - omega_i;

    // Diffuse + ambient
    let ndotl = max(dot(n, omega_i), 0.0);
    let L_rd = kd * Le * ndotl;
    let L_ra = ka * La;

    // Specular (only on lit side)
    let L_rs = ks * Le * pow(max(dot(w_r, w_o), 0.0), uniforms.s);
    let L_rs_front = select(vec3f(0.0), L_rs, dot(n, omega_i) > 0.0);

    let L_o = L_rd + L_ra + L_rs_front;
    return vec4f(L_o, 1.0);
}
