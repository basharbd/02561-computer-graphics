// ============================================================
// UNIFORMS (shared constants for the whole draw call)
// ============================================================
// mvp           : camera ViewProjection * Model (for main pass)
// model         : model transform (used to move teapot into world)
// lightViewProj : light Projection * light View (for shadow mapping)
// eye           : camera position (for specular view direction)
// visibility    : extra float (often used as multiplier / padding here)
// light_pos     : light position in world
// L_e, L_a      : emitted (direct) and ambient radiance scalars
// k_d, k_s      : diffuse and specular material scalars
// s             : shininess exponent (Phong specular power)
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

// ------------------------------------------------------------
// Bindings (group 0)
// ------------------------------------------------------------
// binding(0) : uniform buffer with all matrices + lighting params
// binding(1) : sampler for ground texture
// binding(2) : ground color texture (xamp23.png)
// binding(3) : shadow map texture (here: rgba32float storing depth in .r)
@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@group(0) @binding(1)
var ourSampler: sampler;

@group(0) @binding(2)
var ourTexture: texture_2d<f32>;

@group(0) @binding(3)
var shadowTexture: texture_2d<f32>;


// ============================================================
// GROUND PASS (textured plane + receives shadow)
// ============================================================

// Vertex output for ground:
// position : clip-space position for rasterization
// texCoord : UVs for sampling the ground texture
// inPos    : world position (used to compute shadow coords in fragment)
struct VSOutGround {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
    @location(1) inPos: vec4f,
}

@vertex
fn main_vs_ground(@location(0) inPos: vec3f, @location(3) texCoord: vec2f) -> VSOutGround {
    var vsOut: VSOutGround;

    // Ground model = identity, so (inPos) is already world-space.
    // We still multiply by MVP to get clip-space for rendering.
    vsOut.position = uniforms.mvp * vec4f(inPos, 1.0);

    // Pass UV through to fragment for texture lookup
    vsOut.texCoord = texCoord;

    // Keep world position for shadow mapping (lightViewProj expects world coords)
    vsOut.inPos = vec4f(inPos, 1.0);

    return vsOut;
}

@fragment
fn main_fs_ground(@location(0) texCoords: vec2f, @location(1) inPos: vec4f) -> @location(0) vec4f {

    // --------------------------------------------------------
    // 1) Compute shadow map coordinates
    // --------------------------------------------------------
    // Transform world position into the light's clip space
    let p_clip_l = uniforms.lightViewProj * inPos;

    // Convert from clip space -> NDC (divide by w), then map:
    // x: [-1, 1] -> [0, 1]
    // y: [-1, 1] -> [0, 1] but flipped (texture coords are top-left oriented)
    // z: keep as NDC z for comparison (your mapping keeps z as is here)
    let shadowCoords = (p_clip_l.xyz / p_clip_l.w) * vec3f(0.5, -0.5, 1.0) + vec3f(0.5, 0.5, 0.0);

    // The current fragment depth from the light’s view (the value we test)
    let z_light = shadowCoords.z;

    // --------------------------------------------------------
    // 2) Fetch stored depth from shadow map
    // --------------------------------------------------------
    // Convert [0,1] UV to integer texel coordinates (2048x2048)
    // Depth is stored in .r (red channel) of the rgba32float texture
    var depth = textureLoad(shadowTexture, vec2u(shadowCoords.xy * vec2f(2048, 2048)), 0);

    // --------------------------------------------------------
    // 3) Shadow test (with bias)
    // --------------------------------------------------------
    // If stored depth is "closer" than current light depth (minus bias),
    // this fragment is in shadow → reduce visibility to ~ambient factor.
    // select(a,b,cond) returns a when cond=false, b when cond=true
    let visibility = select(1.0, 0.4, depth.r < z_light - 0.001);

    // --------------------------------------------------------
    // 4) Shade ground: texture * visibility
    // --------------------------------------------------------
    let texColor = textureSample(ourTexture, ourSampler, texCoords);
    return vec4f((texColor.rgb * visibility), texColor.a);
}


// ============================================================
// TEAPOT PASS (Phong shading + self-shadowing)
// ============================================================

// Vertex output for teapot:
// position : clip-space position for rasterization
// inPos    : object-space position (used later with uniforms.model)
// color    : vertex color (not used in lighting here, but passed through)
// normal   : object-space normal (used for lighting; normalized in fragment)
struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) inPos: vec4f,
    @location(1) color: vec4f,
    @location(2) normal: vec4f,
}

@vertex
fn main_vs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> VSOut {
    var vsOut: VSOut;

    // Main pass clip position (camera MVP)
    vsOut.position = uniforms.mvp * inPos;

    // Pass-through data for fragment shading
    vsOut.inPos = inPos;
    vsOut.color = color;
    vsOut.normal = normal;

    return vsOut;
}

@fragment
fn main_fs_teapot(@location(0) inPos: vec4f, @location(1) color: vec4f, @location(2) normal: vec4f) -> @location(0) vec4f {

    // Normalize interpolated normal (interpolation breaks unit length)
    let n = normalize(normal.xyz);

    // --------------------------------------------------------
    // 1) Self-shadow visibility (shadow mapping test)
    // --------------------------------------------------------
    // Transform teapot surface point into world space, then into light clip space
    let p_clip_l = uniforms.lightViewProj * uniforms.model * inPos;

    // Convert to shadow map coords (same mapping as ground)
    let shadowCoords = (p_clip_l.xyz / p_clip_l.w) * vec3f(0.5, -0.5, 1.0) + vec3f(0.5, 0.5, 0.0);

    // Current light-space depth for this fragment
    let z_light = shadowCoords.z;

    // Read closest depth stored in shadow map
    var depth = textureLoad(shadowTexture, vec2u(shadowCoords.xy * vec2f(2048, 2048)), 0);

    // Visibility: 1.0 when lit, 0.4 when in shadow (bias helps acne)
    let visibility = select(1.0, 0.4, depth.r < z_light - 0.005);

    // --------------------------------------------------------
    // 2) Material parameters (Phong)
    // --------------------------------------------------------
    // k_d : diffuse reflectance (here forced to white * scalar)
    // k_a : ambient reflectance (here same as diffuse)
    // k_s : specular reflectance (white * scalar)
    let k_d = vec3f(1) * uniforms.k_d;
    let k_a = k_d;
    let k_s = vec3f(1, 1, 1) * uniforms.k_s;

    // --------------------------------------------------------
    // 3) Light setup
    // --------------------------------------------------------
    // Light direction from surface point to light position in world space:
    // (light_pos - worldPos). Here you compute with (uniforms.model * inPos)
    let l_e = -normalize(uniforms.light_pos - (uniforms.model * inPos).xyz);

    // omega_i is the incident light direction (pointing toward surface)
    let omega_i = -l_e;

    // Radiance scalars expanded to RGB (white light)
    let L_e = vec3f(1, 1, 1) * uniforms.L_e;
    let L_i = L_e;
    let L_a = vec3f(1, 1, 1) * uniforms.L_a;

    // --------------------------------------------------------
    // 4) View + reflection vectors
    // --------------------------------------------------------
    // w_o : direction from surface to eye (view vector)
    let w_o = normalize(uniforms.eye - inPos.xyz);

    // w_r : perfect reflection direction of omega_i around normal n
    let w_r = 2 * dot(omega_i, n) * n - omega_i;

    // --------------------------------------------------------
    // 5) Phong terms
    // --------------------------------------------------------
    // Specular: k_s * L_i * (max(dot(w_r, w_o),0)^shininess)
    let L_P_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), uniforms.s);

    // Diffuse: k_d * L_e * max(dot(n, omega_i),0)
    let L_rd = k_d * L_e * max(dot(n, omega_i), 0.0);

    // Ambient: k_a * L_a
    let L_ra = k_a * L_a;

    // Prevent specular on back faces (only if light is on the front side)
    let L_P_rs_select = select(vec3f(0, 0, 0), L_P_rs, dot(n, omega_i) > 0.0);

    // Combine: shadow affects (diffuse + specular), ambient always added
    let L_o = (L_rd + L_P_rs_select) * visibility + L_ra;

    return vec4f(L_o, 1.0);
}


// ============================================================
// SHADOW DEPTH PASS (render teapot from light POV)
// ============================================================

@vertex
fn main_vs_depth(@location(0) inPos: vec4f) -> @builtin(position) vec4f {
    // Light-space clip position = lightViewProj * model * position
    // This is what produces fragcoord.z used for the stored depth.
    return uniforms.lightViewProj * uniforms.model * inPos;
}

@fragment
fn main_fs_depth(@builtin(position) fragcoord: vec4f) -> @location(0) vec4f {
    // Store fragment depth into the output texture.
    // Here you write z into RGB (all equal) and alpha = 1.
    // Later you read depth.r during the shadow test.
    return vec4f(vec3f(fragcoord.z), 1.0);
}
