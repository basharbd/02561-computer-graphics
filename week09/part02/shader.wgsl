struct Uniforms {
    mvp: mat4x4f,      // Combined transform used by the *current* draw (ground / teapot / shadow)
    model: mat4x4f,    // Object-to-world transform (mainly used for correct light direction on the teapot)
    eye: vec3f,        // Camera position (used for view vector in specular term)
    visibility: f32,   // Scalar multiplier for “darken / fade” control (ground/shadow usage)
    light_pos: vec3f,  // Point light position (world space, as used by your math)
    L_e: f32,          // Emitted radiance/intensity of the light
    L_a: f32,          // Ambient radiance/intensity
    k_d: f32,          // Diffuse material coefficient
    k_s: f32,          // Specular material coefficient
    s: f32,            // Shininess exponent (Phong “tightness”)
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;
@group(0) @binding(1)
var ourSampler: sampler;
@group(0) @binding(2)
var ourTexture: texture_2d<f32>;

// ----------------------------
// GROUND PIPELINE I/O
// ----------------------------
struct VSOutGround {
    @builtin(position) position: vec4f, // Clip-space position
    @location(0) texCoord: vec2f,       // UV forwarded to fragment shader
}

@vertex
fn main_vs_ground(@location(0) inPos: vec4f, @location(3) texCoord: vec2f) -> VSOutGround {
    var vsOut: VSOutGround;
    vsOut.position = uniforms.mvp * inPos; // Standard MVP transform
    vsOut.texCoord = texCoord;             // Pass UV through
    return vsOut;
}

@fragment
fn main_fs_ground(@location(0) texCoords: vec2f) -> @location(0) vec4f {
    // Texture lookup (ground) with an RGB visibility multiplier
    return textureSample(ourTexture, ourSampler, texCoords)
         * vec4f(uniforms.visibility, uniforms.visibility, uniforms.visibility, 1.0);
}

// ----------------------------
// TEAPOT PIPELINE I/O
// ----------------------------
struct VSOut {
    @builtin(position) position: vec4f, // Clip-space position
    @location(0) inPos: vec4f,          // Original model-space position (used downstream)
    @location(1) color: vec4f,          // Vertex color (passed through, not used in your current shading)
    @location(2) normal: vec4f,         // Model-space normal (normalized in fragment)
}

@vertex
fn main_vs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> VSOut {
    var vsOut: VSOut;
    vsOut.position = uniforms.mvp * inPos; // Standard MVP transform
    vsOut.inPos = inPos;                   // Keep original position for lighting math
    vsOut.color = color;                   // Forward color (available if you want later)
    vsOut.normal = normal;                 // Forward normal (renormalized in fragment)
    return vsOut;
}

@fragment
fn main_fs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> @location(0) vec4f {
    // Interpolated normals need renormalization
    let n = normalize(normal.xyz);

    // Material terms 
    let k_d = vec3f(1) * uniforms.k_d;
    let k_a = k_d;
    let k_s = vec3f(1, 1, 1) * uniforms.k_s;

    // Point light direction computed using world position (model * inPos)
    let l_e = -normalize(uniforms.light_pos - (uniforms.model * inPos).xyz);
    let omega_i = -l_e;

    // Radiance/intensity terms (white light scaled by sliders)
    let L_e = vec3f(1, 1, 1) * uniforms.L_e;
    let L_i = L_e;
    let L_a = vec3f(1, 1, 1) * uniforms.L_a;

    // View vector and reflection vector (Phong specular)
    let w_o = normalize(uniforms.eye - inPos.xyz);
    let w_r = 2 * dot(omega_i, n) * n - omega_i;

    // Specular + diffuse + ambient components
    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);
    let L_rd = k_d * L_e * max(dot(n, omega_i), 0.0);
    let L_ra = k_a * L_a;

    // Prevent specular highlights on the back-facing side
    let L_P_rs_select = select(vec3f(0, 0, 0), L_P_rs, dot(n, omega_i) > 0.0);

    // Final outgoing radiance (RGB)
    let L_o = L_rd + L_ra + L_P_rs_select;
    return vec4f(L_o, 1.0);
}

// ----------------------------
// SHADOW PIPELINE (projected geometry)
// ----------------------------
@vertex
fn main_vs_shadow(@location(0) inPos: vec4f) -> @builtin(position) vec4f {
    // Shadow draw uses a different MVP in the same uniforms slot
    return uniforms.mvp * inPos;
}

@fragment
fn main_fs_shadow() -> @location(0) vec4f {
    // Solid color shadow (coverage handled by geometry/projection in JS)
    return vec4f(0.0, 0.0, 0.0, 1.0);
}
