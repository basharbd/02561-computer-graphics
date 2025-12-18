// ============================================================
// UNIFORMS (CPU → GPU constant parameters)
// ============================================================
// This struct is written from JS into a uniform buffer.
// Important idea: uniform buffers follow alignment rules (16-byte friendly).
struct Uniforms {
    // Camera/eye position in world (or view) space (depends on your convention).
    // vec3f is 12 bytes, but uniforms are aligned in a way that often introduces padding.
    eye: vec3f,

    // Emitted radiance / light intensity scalar (L_e).
    // This is a single float that conveniently fills the remaining 4 bytes
    // after vec3f to make a full 16-byte block.
    L_e: f32,

    // Ambient radiance scalar (L_a)
    L_a: f32,

    // Diffuse coefficient scalar (k_d)
    k_d: f32,

    // Specular coefficient scalar (k_s)
    k_s: f32,

    // Shininess exponent (s) in Phong
    s: f32,

    // NOTE ABOUT PADDING:
    // After these scalars, the next member is a mat4x4f.
    // mat4x4f is aligned to 16 bytes, so the struct will insert padding
    // so that mvp starts on a 16-byte boundary.
    // The CPU side solves this by using a Float32Array layout that respects offsets.
    mvp: mat4x4f,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// ============================================================
// VERTEX OUTPUT (what the vertex shader passes to fragment)
// ============================================================
struct VSOut {
    // Clip-space position used by the rasterizer.
    @builtin(position) position: vec4f,

    // Carry per-vertex data to the fragment shader (interpolated across triangles).
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f,
};

// ============================================================
// VERTEX SHADER
// ============================================================
// Takes vertex attributes (position, color, normal), transforms position by MVP,
// then passes the attributes forward for lighting in the fragment stage.
@vertex
fn main_vs(
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f,
    @builtin(instance_index) instance: u32
) -> VSOut {
    var vsOut: VSOut;

    // Transform model vertex position into clip space.
    // MVP = Projection * View * Model (precomputed on CPU side).
    vsOut.position = uniforms.mvp * inPos;

    // Pass-through attributes (will be interpolated).
    vsOut.inPos = inPos;
    vsOut.color = color;
    vsOut.normal = normal;

    // instance is unused here; kept for compatibility with instanced pipelines.
    return vsOut;
}

// ============================================================
// FRAGMENT SHADER (Phong lighting)
// ============================================================
// Runs per-pixel. Computes lighting using:
// - Diffuse (Lambert): k_d * L * max(dot(n, omega_i), 0)
// - Ambient:           k_a * L_a
// - Specular (Phong):  k_s * L * max(dot(r, v), 0)^s
@fragment
fn main_fs(
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f
) -> @location(0) vec4f {

    // Interpolated normals are not unit length → normalize for correct lighting.
    let n = normalize(normal.xyz);

    // Material coefficients:
    // - Use vertex color as the "base diffuse color"
    // - Scale by slider uniforms.k_d
    let k_d = color.xyz * uniforms.k_d;

    // Simple choice: ambient reflectance equals diffuse reflectance.
    let k_a = k_d;

    // Specular reflectance (white highlights), scaled by slider uniforms.k_s.
    let k_s = vec3f(1.0, 1.0, 1.0) * uniforms.k_s;

    // ------------------------------------------------------------
    // LIGHT SETUP (directional light, fixed direction)
    // ------------------------------------------------------------
    // l_e is the direction *the light travels* (emitted direction).
    // Here: (0,0,-1) means light rays go in -Z direction.
    const l_e = vec3f(0.0, 0.0, -1.0);

    // omega_i is the direction from the surface point *toward the light*.
    // For a directional light, it's just the opposite of l_e.
    const omega_i = -l_e;

    // Light intensities (RGB), derived from scalar sliders.
    let L_e = vec3f(1.0, 1.0, 1.0) * uniforms.L_e; // emitted radiance (direct light)
    let L_i = L_e;                                 // incident radiance (same here)
    let L_a = vec3f(1.0, 1.0, 1.0) * uniforms.L_a; // ambient radiance

    // ------------------------------------------------------------
    // VIEW + REFLECTION DIRECTIONS
    // ------------------------------------------------------------
    // w_o: direction from surface point toward the eye/camera.
    // NOTE: here inPos is assumed to be in the same space as uniforms.eye.
    let w_o = normalize(uniforms.eye - inPos.xyz);

    // w_r: perfect mirror reflection direction of omega_i around normal n.
    // reflect( -omega_i, n ) could also be used, but we keep the explicit formula.
    let w_r = 2.0 * dot(omega_i, n) * n - omega_i;

    // ------------------------------------------------------------
    // PHONG TERMS
    // ------------------------------------------------------------
    // Specular: k_s * L_i * (max(dot(w_r, w_o), 0))^s
    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);

    // Diffuse: k_d * L_e * max(dot(n, omega_i), 0)
    let L_rd = k_d * L_e * max(dot(n, omega_i), 0.0);

    // Ambient: k_a * L_a
    let L_ra = k_a * L_a;

    // Prevent specular highlights on the back side:
    // Only allow specular if the light is on the same hemisphere as the normal.
    let L_P_rs_select = select(vec3f(0.0, 0.0, 0.0), L_P_rs, dot(n, omega_i) > 0.0);

    // Final outgoing radiance (simple sum).
    let L_o = L_rd + L_ra + L_P_rs_select;

    return vec4f(L_o, 1.0);
}
