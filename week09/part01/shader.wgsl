// Uniform block shared by both pipelines (ground + teapot).
// Packed as a single struct so the JS side can write one UBO layout.
struct Uniforms {
    mvp: mat4x4f,        // clip-space transform (Projection * View * Model)
    model: mat4x4f,      // model matrix (used to place the teapot in the world)
    eye: vec3f,          // camera position (world space)
    visibility: f32,     // visibility multiplier (used to darken the ground for shadows)
    light_pos: vec3f,    // light position (world space)
    L_e: f32,            // emitted radiance scale (light intensity)
    L_a: f32,            // ambient radiance scale
    k_d: f32,            // diffuse coefficient
    k_s: f32,            // specular coefficient
    s: f32,              // shininess exponent
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@group(0) @binding(1)
var ourSampler: sampler;

@group(0) @binding(2)
var ourTexture: texture_2d<f32>;

// =====================================================
// GROUND PIPELINE (textured quad + visibility darkening)
// =====================================================

// Vertex output for ground: clip position + UVs
struct VSOutGround {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
}

@vertex
fn main_vs_ground(
    @location(0) inPos: vec4f,          // ground position (vec4 for convenience)
    @location(3) texCoord: vec2f,       // ground UVs (your JS binds this at location 3)
    @builtin(instance_index) instance: u32
) -> VSOutGround {
    var vsOut: VSOutGround;

    // Transform into clip space
    vsOut.position = uniforms.mvp * inPos;

    // Pass UVs straight through
    vsOut.texCoord = texCoord;

    return vsOut;
}

@fragment
fn main_fs_ground(@location(0) texCoords: vec2f) -> @location(0) vec4f {
    // Sample the ground texture and darken it by "visibility"
    // (visibility = 1 -> normal, visibility < 1 -> darker)
    return textureSample(ourTexture, ourSampler, texCoords)
         * vec4f(uniforms.visibility, uniforms.visibility, uniforms.visibility, 1.0);
}

// =======================================
// TEAPOT PIPELINE (Phong lighting on mesh)
// =======================================

// Vertex output for teapot: clip position + data needed for shading
struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) inPos: vec4f,   // object-space position carried to fragment (as provided)
    @location(1) color: vec4f,   // per-vertex color (not used for shading here, but forwarded)
    @location(2) normal: vec4f,  // per-vertex normal (xyz used)
}

@vertex
fn main_vs_teapot(
    @location(0) inPos: vec4f,          // teapot position
    @location(1) color: vec4f,          // teapot color
    @location(2) normal: vec4f,         // teapot normal
    @builtin(instance_index) instance: u32
) -> VSOut {
    var vsOut: VSOut;

    // Clip-space transform
    vsOut.position = uniforms.mvp * inPos;

    // Forward attributes (kept as-is for your current lighting math)
    vsOut.inPos = inPos;
    vsOut.color = color;
    vsOut.normal = normal;

    return vsOut;
}

@fragment
fn main_fs_teapot(
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f
) -> @location(0) vec4f {
    // Normalize interpolated normal (interpolation breaks unit length)
    let n = normalize(normal.xyz);

    // Material coefficients (fixed white material scaled by UI sliders)
    let k_d = vec3f(1) * uniforms.k_d;        // diffuse (albedo-like)
    let k_a = k_d;                            // ambient tied to diffuse
    let k_s = vec3f(1, 1, 1) * uniforms.k_s;  // specular (white)

    // Light direction setup
    // Compute vector from surface point (world) to light position (world),
    // then flip signs to match omega_i convention used below.
    let l_e = -normalize(uniforms.light_pos - (uniforms.model * inPos).xyz);
    let omega_i = -l_e;

    // Light/ambient radiance scales (white light)
    let L_e = vec3f(1, 1, 1) * uniforms.L_e;
    let L_i = L_e;
    let L_a = vec3f(1, 1, 1) * uniforms.L_a;

    // View direction 
    let w_o = normalize(uniforms.eye - inPos.xyz);

    // Perfect reflection direction of the incoming light about the normal
    let w_r = 2 * dot(omega_i, n) * n - omega_i;

    // Specular term (Phong)
    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);

    // Diffuse term (Lambert)
    let L_rd = k_d * L_e * max(dot(n, omega_i), 0.0);

    // Ambient term
    let L_ra = k_a * L_a;

    // Hide specular highlights on back-facing fragments (light behind the surface)
    let L_P_rs_select = select(vec3f(0, 0, 0), L_P_rs, dot(n, omega_i) > 0.0);

    // Final outgoing radiance (RGB)
    let L_o = L_rd + L_ra + L_P_rs_select;

    return vec4f(L_o, 1.0);
}
